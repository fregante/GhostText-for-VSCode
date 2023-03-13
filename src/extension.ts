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

	// Listen for incoming messages on the WebSocket
	// Don't `await` anything before this or else it might come too late
	socket.on('message', async rawMessage => {
		const {document} = await tab;
		const message = JSON.parse(String(rawMessage)) as {text: string};

		// When a message is received, replace the document content with the message
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			message.text,
		);
		await vscode.workspace.applyEdit(edit);
	});

	// Listen for editor changes
	const typeListener = vscode.workspace.onDidChangeTextDocument(
		async event => {
			const {document} = await tab;

			if (event.document === document) {
				// When the editor content changes, send the new content back to the client
				const content = event.document.getText();
				socket.send(JSON.stringify({text: content, selections: []}));
			}
		},
	);

	const tabCloseListener = vscode.workspace.onDidCloseTextDocument(
		async doc => {
			const {document} = await tab;

			if (doc === document && doc.isClosed) {
				console.log('document close');
				socket.close();
			}
		},
	);

	context.subscriptions.push(typeListener, tabCloseListener);
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
