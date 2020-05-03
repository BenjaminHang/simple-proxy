// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { ProxyTableView } from './proxyTable';


export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "simpleProxy" is now active!');
	
	new ProxyTableView(context);

}

export function deactivate() {

}
