/* eslint-disable @typescript-eslint/naming-convention */

import * as http from 'node:http';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import process from 'node:process';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';
import filenamify from 'filenamify';

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

async function createTab(title: string) {
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
	return {document, editor};
}

function startGT(socket: WebSocket) {
	let tab: Promise<Tab>;
	/** When the browser sends new content, the editor should not detect this "change" event and echo it */
	let updateFromBrowserInProgress = false;

	// Socket.on('close', async () => {
	// 	const {document} = await tab;
	// });

	// Listen for incoming messages on the WebSocket
	// Don't `await` anything before this or else it might come too late
	socket.on('message', async (rawMessage) => {
		const {text, selections, title} = JSON.parse(String(rawMessage)) as {
			text: string;
			title: string;
			selections: Array<{start: number; end: number}>;
		};

		tab ??= createTab(title);
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

/**
 * CodelensProvider
 */
export class CodelensProvider implements vscode.CodeLensProvider {
	private codeLenses: vscode.CodeLens[] = [];
	private readonly regex: RegExp;
	private readonly _onDidChangeCodeLenses: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();

	// eslint-disable-next-line @typescript-eslint/member-ordering
	public readonly onDidChangeCodeLenses: vscode.Event<void> =
		this._onDidChangeCodeLenses.event;

	constructor() {
		this.regex = /(.+)/g;

		vscode.workspace.onDidChangeConfiguration((_) => {
			this._onDidChangeCodeLenses.fire();
		});
	}

	public provideCodeLenses(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
		if (
			vscode.workspace
				.getConfiguration('codelens-sample')
				.get('enableCodeLens', true)
		) {
			this.codeLenses = [];
			const regex = new RegExp(this.regex);
			const text = document.getText();
			let matches;
			while ((matches = regex.exec(text)) !== null) {
				const line = document.lineAt(document.positionAt(matches.index).line);
				const indexOf = line.text.indexOf(matches[0]);
				const position = new vscode.Position(line.lineNumber, indexOf);
				const range = document.getWordRangeAtPosition(
					position,
					new RegExp(this.regex),
				);
				if (range) {
					this.codeLenses.push(new vscode.CodeLens(range));
				}
			}

			return this.codeLenses;
		}

		return [];
	}

	public resolveCodeLens(
		codeLens: vscode.CodeLens,
		token: vscode.CancellationToken,
	) {
		codeLens.command = {
			title: 'Codelens provided by sample extension',
			tooltip: 'Tooltip provided by sample extension',
			command: 'codelens-sample.codelensAction',
			arguments: ['Argument 1', false],
		};
		return codeLens;
	}
}

export function activate(_context: vscode.ExtensionContext) {
	context = _context;
	createServer();

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

	const codelensProvider = new CodelensProvider();

	vscode.languages.registerCodeLensProvider('*', codelensProvider);
}
