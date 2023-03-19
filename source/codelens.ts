import * as vscode from 'vscode';
import {documents} from './state.js';

class GhostTextCodeLensProvider implements vscode.CodeLensProvider {
	public readonly _onDidChangeCodeLenses: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();

	public readonly onDidChangeCodeLenses: vscode.Event<void> =
		this._onDidChangeCodeLenses.event;

	provideCodeLenses(
		document: vscode.TextDocument,
	): vscode.ProviderResult<vscode.CodeLens[]> {
		if (!documents.has(document.uri.toString())) {
			return [];
		}

		const range = new vscode.Range(0, 0, 0, 0);
		const command: vscode.Command = {
			title: '👻 🌕 GhostText connected | Disconnect',
			command: 'ghostText.disconnect',
			arguments: [document.uri.toString()],
		};
		return [new vscode.CodeLens(range, command)];
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const codeLensProvider = new GhostTextCodeLensProvider();
	const codeLensDisposable = vscode.languages.registerCodeLensProvider(
		{pattern: '**/*'},
		codeLensProvider,
	);
	context.subscriptions.push(codeLensDisposable);
	documents.onRemove(
		() => {
			codeLensProvider._onDidChangeCodeLenses.fire();
		},
		null,
		context.subscriptions,
	);
}
