import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import process from 'node:process';

const exec = promisify(execFile);

const osxFocus = `
	tell application "Visual Studio Code"
		activate
	end tell`;
export async function bringEditorToFront() {
	if (process.platform === 'darwin') {
		void exec('osascript', ['-e', osxFocus]);
	}
}
