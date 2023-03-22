import * as http from 'node:http';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';
import {type Subscriptions} from './vscode.js';

let server: http.Server | undefined;

function getPort() {
	return vscode.workspace.getConfiguration('ghostText').get('serverPort', 4001);
}

async function pingResponder(_: unknown, response: http.ServerResponse) {
	response.writeHead(200, {
		'Content-Type': 'application/json',
	});
	response.end(
		JSON.stringify({
			// eslint-disable-next-line @typescript-eslint/naming-convention
			ProtocolVersion: 1,
			// eslint-disable-next-line @typescript-eslint/naming-convention
			WebSocketPort: getPort(),
		}),
	);
}

export class Eaddrinuse extends Error {}

async function listen(server: http.Server) {
	const port = getPort();
	return new Promise((resolve, reject) => {
		server
			.listen(getPort())
			.once('listening', resolve)
			.once('error', (error) => {
				if ((error as any).code === 'EADDRINUSE') {
					reject(new Eaddrinuse(`The port ${port} is already in use`));
				} else {
					reject(error);
				}
			});
	});
}

export async function startServer(
	subscriptions: Subscriptions,
	onConnection: (socket: WebSocket) => void,
) {
	console.log('GhostText: Server starting');
	server?.close();
	server = http.createServer(pingResponder);

	await listen(server);
	const ws = new Server({server});
	ws.on('connection', onConnection);
	console.log('GhostText: Server started');

	void vscode.commands.executeCommand('setContext', 'ghostText.server', true);
	subscriptions.push({
		dispose() {
			server?.close();
		},
	});
}

export function stopServer(): void {
	server?.close();
	server = undefined;
	console.log('GhostText: Server stopped');

	void vscode.commands.executeCommand('setContext', 'ghostText.server', false);
}
