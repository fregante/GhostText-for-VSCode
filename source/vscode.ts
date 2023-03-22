import * as vscode from 'vscode';

export type Subscriptions = vscode.ExtensionContext['subscriptions'];

export function registerCommand(
	command: string,
	callback: (...args: any[]) => any,
	subscriptions: Subscriptions,
) {
	subscriptions.push(vscode.commands.registerCommand(command, callback));
}
