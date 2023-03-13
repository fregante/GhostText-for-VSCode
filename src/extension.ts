/* eslint-disable @typescript-eslint/naming-convention */

import * as http from 'node:http';
import getPort from 'get-port';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';

let context: vscode.ExtensionContext;
let server: http.Server;

async function createTab() {
	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: 'Loading…',
	});
	const editor = await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.Active,
	});
	return {document, editor};
}

function startGT(socket: WebSocket) {
	const tab = createTab();

	// Listen for incoming messages on the WebSocket
	// Don't `await` anything before this or else it might come too late
	socket.on('message', async (rawMessage) => {
		const {document, editor} = await tab;
		const {text, selections} = JSON.parse(String(rawMessage)) as {
			text: string;
			selections: Array<{start: number; end: number}>;
		};

		// When a message is received, replace the document content with the message
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			text,
		);
		await vscode.workspace.applyEdit(edit);

		editor.selections = selections.map(
			(selection) =>
				new vscode.Selection(
					document.positionAt(selection.start),
					document.positionAt(selection.end),
				),
		);
	});

	// Listen for editor changes
	vscode.workspace.onDidChangeTextDocument(
		async (event) => {
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

	const tabCloseListener = vscode.workspace.onDidCloseTextDocument(
		async (closedDocument) => {
			const {document} = await tab;

			if (closedDocument === document) {
				socket.close();
			}
		},
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
	context.subscriptions.push({
		dispose() {
			server.close();
		},
	});

	async function requestListener(
		request: unknown,
		response: http.ServerResponse,
	) {
		response.writeHead(200, {
			'Content-Type': 'application/json',
		});
		const port = await getPort();
		response.end(
			JSON.stringify({
				ProtocolVersion: 1,
				WebSocketPort: port,
			}),
		);

		const ws = new Server({port});
		ws.on('connection', startGT);
		context.subscriptions.push({
			dispose() {
				ws.close();
			},
		});
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
}
