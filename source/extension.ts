import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import process from 'node:process';
import {type IncomingMessage} from 'node:http';
import * as vscode from 'vscode';
import {type WebSocket} from 'ws';
import filenamify from 'filenamify';
import * as codelens from './codelens.js';
import {documents} from './state.js';
import {startServer, stopServer} from './server.js';
import {registerCommand} from './vscode.js';

/** When the browser sends new content, the editor should not detect this "change" event and echo it */
let updateFromBrowserInProgress = false;

const exec = promisify(execFile);
let context: vscode.ExtensionContext;

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

async function initView(title: string, socket: WebSocket) {
	const t = new Date();
	// This string is visible if multiple tabs are open from the same page
	const avoidsOverlappingFiles = `${t.getHours()}-${t.getMinutes()}-${t.getSeconds()}`;
	const filename = `${filenamify(title.trim(), {replacement: '-'})}.${getFileExtension()}`;
	const file = vscode.Uri.from({
		scheme: 'untitled',
		path: `${tmpdir()}/${avoidsOverlappingFiles}/${filename}`,
	});
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

function openConnection(socket: WebSocket, request: IncomingMessage) {
	try {
		if (!new URL(request.headers.origin!).protocol.endsWith('extension:')) {
			socket.close();
			return;
		}
	} catch {
		socket.close();
		return;
	}

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

function getFileExtension(): string {
	// Use || to set the default or else an empty field will override it
	// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
	return vscode.workspace.getConfiguration('ghostText').get('fileExtension') || 'ghosttext';
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
	if (event.affectsConfiguration('ghostText.serverPort')) {
		startServer(context.subscriptions, openConnection);
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
	const {subscriptions} = context;

	const setup = [null, subscriptions] as const;
	startServer(subscriptions, openConnection);
	codelens.activate(subscriptions);

	// Watch for changes to the HTTP port option
	// This event is already debounced
	vscode.workspace.onDidChangeConfiguration(onConfigurationChange, ...setup);
	vscode.workspace.onDidCloseTextDocument(onDocumentClose, ...setup);
	vscode.window.onDidChangeTextEditorSelection(onLocalSelection, ...setup);
	vscode.workspace.onDidChangeTextDocument(onLocalEdit, ...setup);
	registerCommand('ghostText.disconnect', onDisconnectCommand, subscriptions);
	registerCommand('ghostText.stopServer', stopServer, subscriptions);
	registerCommand(
		'ghostText.startServer',
		async () => {
			startServer(subscriptions, openConnection);
		},
		subscriptions,
	);

	context.subscriptions.push({
		dispose() {
			documents.clear();
		},
	});
}
