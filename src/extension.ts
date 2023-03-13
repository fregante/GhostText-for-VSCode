/* eslint-disable @typescript-eslint/naming-convention */

import * as http from 'node:http';
import getPort from 'get-port';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';

let context: vscode.ExtensionContext;
let server: http.Server;

async function createTab() {
	// Create a new tab named "ghosttext.md" in the workspace
	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: 'Loading…',
	});
	const editor = await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.One,
	});
	return {document, editor};
}

function newConnection(socket: WebSocket) {
	const tab = createTab();
	const lastKnownContent = '';

	// Listen for incoming messages on the WebSocket
	// Don't `await` anything before this or else it might come too late
	socket.on('message', async rawMessage => {
		const {document, editor} = await tab;
		const {text, selections} = JSON.parse(String(rawMessage)) as {text: string; selections: Array<{start: number; end: number}>};

		// When a message is received, replace the document content with the message
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			text,
		);
		await vscode.workspace.applyEdit(edit);

		editor.selections = selections.map(selection => new vscode.Selection(
			document.positionAt(selection.start),
			document.positionAt(selection.end),
		));
	});

	// Listen for editor changes
	const typeListener = vscode.workspace.onDidChangeTextDocument(
		async event => {
			const {document, editor} = await tab;

			if (event.document === document) {
				// When the editor content changes, send the new content back to the client
				const content = document.getText();

				const selections = editor.selections.map(selection => ({
					start: document.offsetAt(selection.start),
					end: document.offsetAt(selection.end),
				}));
				socket.send(JSON.stringify({text: content, selections}));
			}
		},
	);

	const tabCloseListener = vscode.workspace.onDidCloseTextDocument(
		async doc => {
			const {document} = await tab;

			if (doc === document && doc.isClosed) {
				socket.close();
			}
		},
	);

	const selectionChangeListener
	= vscode.window.onDidChangeTextEditorSelection(async event => {
		const {document} = await tab;

		if (event.textEditor.document === document) {
			const content = document.getText();

			const selections = event.selections.map(selection => ({
				start: document.offsetAt(selection.start),
				end: document.offsetAt(selection.end),
			}));
			socket.send(JSON.stringify({text: content, selections}));
		}
	});

	context.subscriptions.push(typeListener, tabCloseListener, selectionChangeListener);
}

function createServer() {
	server?.close();
	const httpPort
    = vscode.workspace.getConfiguration('myExtension').get('httpPort') ?? 4001;

	server = http
		.createServer(async (request, response) => {
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

			const server = new Server({port});
			server.on('connection', newConnection);
			context.subscriptions.push({
				dispose() {
					server.close();
				},
			});
		})
		.listen(httpPort);
}

export function activate(_context: vscode.ExtensionContext) {
	context = _context;
	createServer();

	// Watch for changes to the HTTP port option
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('myExtension.httpPort')) {
				createServer();
			}
		}),
	);
}
