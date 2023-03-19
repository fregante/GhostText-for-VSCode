import * as vscode from 'vscode';
import {type WebSocket} from 'ws';

type Uri = string;
type Field = {
	uri: string;
	document: vscode.TextDocument;
	editor: vscode.TextEditor;
	socket: WebSocket;
};

class State extends Map<Uri, Field> {
	private readonly remove = new vscode.EventEmitter<Uri>();
	private readonly add = new vscode.EventEmitter<Uri>();
	// eslint-disable-next-line @typescript-eslint/member-ordering
	readonly onRemove = this.remove.event;
	// eslint-disable-next-line @typescript-eslint/member-ordering
	readonly onAdd = this.add.event;

	override set(uri: Uri, field: Field) {
		super.set(uri, field);
		this.add.fire(uri);
		return this;
	}

	override delete(uri: Uri) {
		const removed = super.delete(uri);
		if (removed) {
			this.remove.fire(uri);
		}

		return removed;
	}
}

export const documents = new State();
