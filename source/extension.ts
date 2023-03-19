/* eslint-disable @typescript-eslint/naming-convention */

import * as http from 'node:http';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import process from 'node:process';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';
import filenamify from 'filenamify';
import * as codelens from './codelens.js';
import {documents} from './state.js';

const exec = promisify(execFile);
let context: vscode.ExtensionContext;
let server: http.Server;
let ws: Server;

const osxFocus = `
	tell application "Visual Studio Code"
		activate
	end tell`;
function bringEditorToFront() {
	if (process.platform === 'darwin') {
		void exec('osascript', ['-e', osxFocus]);
	}
}

type Tab = {document: vscode.TextDocument; editor: vscode.TextEditor};

async function createTab(title: string, socket: WebSocket) {
	const t = new Date();
	// This string is visible if multiple tabs are open from the same page
	const avoidsOverlappingFiles = `${t.getHours()}-${t.getMinutes()}-${t.getSeconds()}`;
	const file = vscode.Uri.parse(
		`untitled:${avoidsOverlappingFiles}/${filenamify(title.trim())}.md`,
	);
	const document = await vscode.workspace.openTextDocument(file);
	const editor = await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.Active,
		preview: false,
	});

	bringEditorToFront();
	const uriString = file.toString();
	documents.set(uriString, {
		uri: uriString,
		document,
		editor,
		socket,
	});
	documents.onRemove((removedUriString) => {
		if (uriString === removedUriString) {
			socket.close();
		}
	});
	return {document, editor};
}

function startGT(socket: WebSocket) {
	let tab: Promise<Tab>;
	/** When the browser sends new content, the editor should not detect this "change" event and echo it */
	let updateFromBrowserInProgress = false;

	socket.on('close', async () => {
		const {document} = await tab;
		documents.delete(document.uri.toString());
	});

	// Listen for incoming messages on the WebSocket
	// Don't `await` anything before this or else it might come too late
	socket.on('message', async (rawMessage) => {
		const {text, selections, title} = JSON.parse(String(rawMessage)) as {
			text: string;
			title: string;
			selections: Array<{start: number; end: number}>;
		};

		tab ??= createTab(title, socket);
		const {document, editor} = await tab;

		// When a message is received, replace the document content with the message
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			text,
		);

		updateFromBrowserInProgress = true;
		await vscode.workspace.applyEdit(edit);
		updateFromBrowserInProgress = false;

		editor.selections = selections.map(
			(selection) =>
				new vscode.Selection(
					document.positionAt(selection.start),
					document.positionAt(selection.end),
				),
		);
	});

	vscode.workspace.onDidChangeTextDocument(
		async (event) => {
			if (updateFromBrowserInProgress || event.contentChanges.length === 0) {
				return;
			}

			const {document, editor} = await tab;

			if (event.document === document) {
				// When the editor content changes, send the new content back to the client
				const content = document.getText();

				const selections = editor.selections.map((selection) => ({
					start: document.offsetAt(selection.start),
					end: document.offsetAt(selection.end),
				}));
				socket.send(JSON.stringify({text: content, selections}));
			}
		},
		null,
		context.subscriptions,
	);

	vscode.workspace.onDidCloseTextDocument(
		async (closedDocument) => {
			const {document} = await tab;

			// https://github.com/fregante/GhostText-for-VSCode/issues/2
			if (closedDocument === document && closedDocument.isClosed) {
				socket.close();
			}
		},
		null,
		context.subscriptions,
	);

	vscode.window.onDidChangeTextEditorSelection(
		async (event) => {
			const {document} = await tab;

			if (event.textEditor.document !== document) {
				return;
			}

			const content = document.getText();

			const selections = event.selections.map((selection) => ({
				start: document.offsetAt(selection.start),
				end: document.offsetAt(selection.end),
			}));
			socket.send(JSON.stringify({text: content, selections}));
		},
		null,
		context.subscriptions,
	);
}

function createServer() {
	server?.close();
	const serverPort =
		vscode.workspace.getConfiguration('ghosttext').get('serverPort') ?? 4001;
	server = http.createServer(requestListener).listen(serverPort);
	ws = new Server({server});
	ws.on('connection', startGT);

	context.subscriptions.push({
		dispose() {
			server.close();
		},
	});

	async function requestListener(
		_request: unknown,
		response: http.ServerResponse,
	) {
		response.writeHead(200, {
			'Content-Type': 'application/json',
		});
		response.end(
			JSON.stringify({
				ProtocolVersion: 1,
				WebSocketPort: serverPort,
			}),
		);

		context.subscriptions.push({
			dispose() {
				ws.close();
			},
		});
	}
}

function disconnectCommand(
	uriString:
		| string
		| undefined = vscode.window.activeTextEditor?.document.uri.toString(),
) {
	console.log('Will disconnect', {uriString});
	if (uriString) {
		documents.delete(uriString);
	}
}

export function activate(_context: vscode.ExtensionContext) {
	context = _context;
	createServer();
	codelens.activate(_context);

	const disconnectCommandDisposable = vscode.commands.registerCommand(
		'ghostText.disconnect',
		disconnectCommand,
	);

	_context.subscriptions.push(disconnectCommandDisposable);

	// Watch for changes to the HTTP port option
	// This event is already debounced
	vscode.workspace.onDidChangeConfiguration(
		(event) => {
			if (event.affectsConfiguration('ghosttext.serverPort')) {
				createServer();
			}
		},
		null,
		context.subscriptions,
	);
}
