import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';

let context: vscode.ExtensionContext;
let server: http.Server;

async function createTab() {
	// Create a new transient workspace
	const folder = await vscode.workspace.updateWorkspaceFolders(0, 0, {
		uri: vscode.Uri.parse('untitled:/ghosttext'),
	});
	const workspace = vscode.workspace.getWorkspaceFolder(folder.uri);

	// Create a new tab named "ghosttext.md" in the workspace
	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: 'Ghost Text',
	});
	const editor = await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.One,
	});
	return {document, editor};
}

async function newConnection(
	socket: WebSocket,
	context: vscode.ExtensionContext,
) {
	const {document} = await createTab();

	// Listen for incoming messages on the WebSocket
	socket.on('message', async message => {
		// When a message is received, replace the document content with the message
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			message.toString(),
		);
		await vscode.workspace.applyEdit(edit);
	});

	// Listen for editor changes
	const disposable = vscode.workspace.onDidChangeTextDocument(async e => {
		if (e.document === document) {
			// When the editor content changes, send the new content back to the client
			const content = e.document.getText();
			socket.send(content);
		}
	});

	context.subscriptions.push(disposable);
}

function createServer() {
	server?.close();
	const httpPort = vscode.workspace
		.getConfiguration('myExtension')
		.get('httpPort');

	server = http
		.createServer(async (request, res) => {
			res.writeHead(200, {
				'Content-Type': 'application/json',
			});

			const port = await getPort();
			res.end(
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
		.listen(4001);
}

export function activate(_context: vscode.ExtensionContext) {
	context = _context;

	// Watch for changes to the HTTP port option
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('myExtension.httpPort')) {
				createServer();
			}
		}),
	);
}
