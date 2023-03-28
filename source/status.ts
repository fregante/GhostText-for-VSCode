import * as vscode from 'vscode';
import {isServerOn} from './server.js';
import {type Subscriptions} from './vscode.js';

let statusBarItem: vscode.StatusBarItem;

function updateStatusBarItem(serverStatus: boolean): void {
	statusBarItem.backgroundColor = serverStatus ? false : '#746001';
	statusBarItem.command = serverStatus ? 'ghostText.stopServer' : 'ghostText.startServer'
}

export function activate(subscriptions: Subscriptions): void {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

	subscriptions.push(statusBarItem);

	updateStatusBarItem(isServerOn());
	statusBarItem.name = 'GhostText';
	statusBarItem.show();
}
