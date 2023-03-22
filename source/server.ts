import * as http from 'node:http';
import * as vscode from 'vscode';
import {type WebSocket, Server} from 'ws';

let server: http.Server;

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

export function createServer(
	subscriptions: vscode.ExtensionContext['subscriptions'],
	onConnection: (socket: WebSocket) => void,
) {
	server?.close();
	server = http.createServer(pingResponder).listen(getPort());
	const ws = new Server({server});
	ws.on('connection', onConnection);

	subscriptions.push({
		dispose() {
			server.close();
		},
	});
}
