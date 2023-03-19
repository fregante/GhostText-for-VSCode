import * as vscode from 'vscode';

const enabledDocuments = new Set<string>();
class GhostTextCodeLensProvider implements vscode.CodeLensProvider {
	public readonly _onDidChangeCodeLenses: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();

	public readonly onDidChangeCodeLenses: vscode.Event<void> =
		this._onDidChangeCodeLenses.event;

	provideCodeLenses(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.CodeLens[]> {
		if (!enabledDocuments.has(document.uri.toString())) {
			return [];
		}

		const firstLine = document.lineAt(0);
		const range = new vscode.Range(0, 0, firstLine.range.start.line, 0);
		const command: vscode.Command = {
			title: '👻 🌕 GhostText connected | Disconnect',
			command: 'ghostText.disconnect',
			arguments: [document.uri.toString()],
		};
		return [new vscode.CodeLens(range, command)];
	}
}

export function add(document: vscode.TextDocument) {
	enabledDocuments.add(document.uri.toString());
}

export function remove(document: vscode.TextDocument) {
	enabledDocuments.delete(document.uri.toString());
}

export function activate(context: vscode.ExtensionContext) {
	const codeLensProvider = new GhostTextCodeLensProvider();
	const codeLensDisposable = vscode.languages.registerCodeLensProvider(
		{scheme: 'untitled'},
		codeLensProvider,
	);
	const disconnectCommandDisposable = vscode.commands.registerCommand(
		'ghostText.disconnect',
		(uriString) => {
			codeLensProvider._onDidChangeCodeLenses.fire(uriString)
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				enabledDocuments.delete(uriString);
			}
		},
	);
	context.subscriptions.push(codeLensDisposable, disconnectCommandDisposable);
}
