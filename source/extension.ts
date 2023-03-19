/* eslint-disable @typescript-eslint/naming-convention */

import * as http from 'node:http';
import {promisify} from 'node:util';
import {join, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import process from 'node:process';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';
import filenamify from 'filenamify';
import * as codelens from './codelens.js';
import {documents} from './state.js';

/** When the browser sends new content, the editor should not detect this "change" event and echo it */
let updateFromBrowserInProgress = false;

const exec = promisify(execFile);
let context: vscode.ExtensionContext;
let server: http.Server;

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

const workspace = join(tmpdir(), 'GhostText');

async function initView(title: string, socket: WebSocket) {
	await mkdir(workspace, {recursive: true});
	const file = vscode.Uri.from({
		scheme: 'untitled',
		path: join(await mkdtemp(workspace + sep), `${filenamify(title.trim())}.md`),
	});
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(workspace), {
		forceNewWindow: true,
	});
	// TODO: actually use window (the next line uses the previous workspace anyway…)
	// TODO: reuse new window
	const document = await vscode.workspace.openTextDocument(file);
	const editor = await vscode.window.showTextDocument(document, {
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

		tab ??= initView(title, socket);
		const {document, editor} = await tab;

		// When a message is received, replace the document content with the message
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);

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
}

function getPort() {
	return vscode.workspace.getConfiguration('ghosttext').get('serverPort', 4001);
}

async function pingResponder(_: unknown, response: http.ServerResponse) {
	response.writeHead(200, {
		'Content-Type': 'application/json',
	});
	response.end(
		JSON.stringify({
			ProtocolVersion: 1,
			WebSocketPort: getPort(),
		}),
	);
}

function createServer() {
	server?.close();
	server = http.createServer(pingResponder).listen(getPort());
	const ws = new Server({server});
	ws.on('connection', startGT);

	context.subscriptions.push({
		dispose() {
			server.close();
		},
	});
}

function mapEditorSelections(
	document: vscode.TextDocument,
	selections: readonly vscode.Selection[],
) {
	return selections.map((selection) => ({
		start: document.offsetAt(selection.start),
		end: document.offsetAt(selection.end),
	}));
}

function onDisconnectCommand(
	uriString: string | undefined = vscode.window.activeTextEditor?.document.uri.toString(),
) {
	if (uriString) {
		documents.delete(uriString);
	}
}

async function onDocumentClose(closedDocument: vscode.TextDocument) {
	// https://github.com/fregante/GhostText-for-VSCode/issues/2
	if (closedDocument.isClosed) {
		documents.delete(closedDocument.uri.toString());
	}
}

async function onLocalSelection(event: vscode.TextEditorSelectionChangeEvent) {
	const document = event.textEditor.document;
	const field = documents.get(document.uri.toString());
	if (!field) {
		return;
	}

	const content = document.getText();
	const selections = mapEditorSelections(document, field.editor.selections);
	field.socket.send(JSON.stringify({text: content, selections}));
}

function onConfigurationChange(event: vscode.ConfigurationChangeEvent) {
	if (event.affectsConfiguration('ghosttext.serverPort')) {
		createServer();
	}
}

async function onLocalEdit(event: vscode.TextDocumentChangeEvent) {
	if (updateFromBrowserInProgress || event.contentChanges.length === 0) {
		return;
	}

	const document = event.document;
	const field = documents.get(document.uri.toString());
	if (!field) {
		return;
	}

	const content = document.getText();
	const selections = mapEditorSelections(document, field.editor.selections);
	field.socket.send(JSON.stringify({text: content, selections}));
}

export function activate(_context: vscode.ExtensionContext) {
	// Set global
	context = _context;

	const setup = [null, context.subscriptions] as const;
	createServer();
	codelens.activate(context);

	// Watch for changes to the HTTP port option
	// This event is already debounced
	vscode.workspace.onDidChangeConfiguration(onConfigurationChange, ...setup);
	vscode.workspace.onDidCloseTextDocument(onDocumentClose, ...setup);
	vscode.window.onDidChangeTextEditorSelection(onLocalSelection, ...setup);
	vscode.workspace.onDidChangeTextDocument(onLocalEdit, ...setup);
	const disconnectCommandDisposable = vscode.commands.registerCommand(
		'ghostText.disconnect',
		onDisconnectCommand,
	);

	context.subscriptions.push(disconnectCommandDisposable, {
		dispose() {
			documents.clear();
		},
	});
}
