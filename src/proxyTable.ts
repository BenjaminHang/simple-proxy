import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Koa from 'koa';
import {createProxyMiddleware as httpProxy} from 'http-proxy-middleware';
const k2c = require('koa2-connect');

export class ProxyTableView {
  private tableView: vscode.TreeView<TableItem>;

  constructor(context: vscode.ExtensionContext) {

    this.tableView = vscode.window.createTreeView('proxyTable', {
      treeDataProvider: new ProxyTableProvider(context)
    }); 

    vscode.commands.registerCommand('proxyTable.reveal', (tableItem: TableItem) => {
      this.reveal(tableItem);
    });
  }

  private reveal(tableItem: TableItem):void {
    this.tableView.reveal(tableItem, {select: true, focus: true});
  }


}

export class ProxyTableProvider implements vscode.TreeDataProvider<TableItem> {
  private dbPath: string;
  private panelObj: {
    [proName: string]: vscode.WebviewPanel
  } = {};

  private app: Koa;
  private server: any;

  private proxies: string[] = [];

  private tableItems: TableItem[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.dbPath = path.resolve(context.extensionPath, 'db/proxyTable.json');
    this.app = new Koa();


    let disposable = vscode.commands.registerCommand('simpleProxy.start', () => {
      this.add();
    });

    context.subscriptions.push(disposable);

    vscode.commands.registerCommand('proxyTable.refreshEntry', () => {
      this.refresh();
    });

    vscode.commands.registerCommand('proxyTable.addEntry', () => {
      this.add();
    });

    vscode.commands.registerCommand('proxyTable.clearAll', () => {
      this.clearAll();
    });

    vscode.commands.registerCommand('proxyTable.openWebview', (treeItem) => {
      this.openWebview(treeItem, context);
    });

    vscode.commands.registerCommand('proxyTable.deleteItem', (treeItem) => {
      this.deleteItem(treeItem);
    });

    vscode.commands.registerCommand('proxyTable.runProxy', (treeItem) => {
      this.run(treeItem);
    });

    vscode.commands.registerCommand('proxyTable.pauseProxy', (treeItem) => {
      this.pause(treeItem);
    });

    vscode.commands.registerCommand('proxyTable.moveTop', (treeItem) => {
      this.moveTop(treeItem);
    });

    vscode.commands.registerCommand('proxyTable.moveUp', (treeItem) => {
      this.moveUp(treeItem);
    });

    vscode.commands.registerCommand('proxyTable.moveDown', (treeItem) => {
      this.moveDown(treeItem);
    });
  }

  getParent(element: TableItem): TableItem {
    return new TableItem('', vscode.TreeItemCollapsibleState.None, TableItemStatus.Run);;
  }

  getTreeItem(element: TableItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TableItem): Thenable<TableItem[]> {
    let tableData = this.getTableData();
    this.tableItems = tableData.map(item => {
      return new TableItem(item.label, vscode.TreeItemCollapsibleState.None, this.proxies.includes(item.label) ? TableItemStatus.Run : TableItemStatus.Pause);
    });
    return Promise.resolve(this.tableItems);
  }

  private getTableData(): TableItemData[] {
    return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
  }

  private setTableData(tableData: TableItemData[]): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(tableData, null, 2), {encoding: 'utf8', flag: 'w'});
  }

  private _onDidChangeTreeData: vscode.EventEmitter<TableItem | undefined> = new vscode.EventEmitter<TableItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TableItem | undefined> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  add(): void {
    vscode.window.showInputBox({
      placeHolder: 'enter name to create proxy'
    }).then(res => {
      if (!res) {return;}
      // 往 proxyTable.json 里写一条
      let tableData = this.getTableData();
      
      if (tableData.some(item => item.label === res)) {
        return vscode.window.showErrorMessage('the name already exists.');
      }

      tableData.push({
        label: res,
        location: "/",
        target: "",
        timeout: 300000,
        pathRewrite: {
          "^/": "/"
        }
      });
      this.setTableData(tableData);
      this.refresh();
      setTimeout(() => {
        let tableItem = this.tableItems.find(item => item.label === res);
        if (!tableItem) {return;}; 
        vscode.commands.executeCommand('proxyTable.reveal', tableItem);
        this.openWebview(tableItem, this.context);
      }, 300);
    });
  }

  deleteItem(treeItem: TableItem): void {
    let tableData = this.getTableData();
    let itemLabel = treeItem.label;
    let index = tableData.findIndex(item => item.label === itemLabel);
    tableData.splice(index, 1);
    this.panelObj[itemLabel]?.dispose();
    Reflect.deleteProperty(this.panelObj, itemLabel);

    this.setTableData(tableData);
    this.refresh();
  }

  clearAll(): void {
    this.setTableData([]);
    this.refresh();
  }

  openWebview(treeItem: TableItem, context: vscode.ExtensionContext): void {
    let itemLabel = treeItem.label;
    if (!this.panelObj[itemLabel]) {
      let tableData = this.getTableData();
      let tableItemData = tableData.find(item => item.label === treeItem.label);
      if (!tableItemData) {return;}
      this.panelObj[itemLabel] = vscode.window.createWebviewPanel(
        'simpleProxy',
        `${itemLabel}[Simple Proxy]`,
        vscode.ViewColumn.One,
        {
          enableScripts: true
        }
      );
      this.panelObj[itemLabel].webview.html = getWebviewContent(tableItemData);
      
      this.panelObj[itemLabel].onDidDispose(
        () => {
          Reflect.deleteProperty(this.panelObj, itemLabel);
        },
        null,
        context.subscriptions
      );

      this.panelObj[itemLabel].webview.onDidReceiveMessage(message => {
        let index = tableData.findIndex(item => item.label === itemLabel);
        if (message.label !== itemLabel && tableData.some(item => item.label === message.label)) {
          return vscode.window.showErrorMessage('the name already exists. save failed!');
        }
        let proxyIndex = this.proxies.indexOf(itemLabel);
        if (proxyIndex !== -1) {
          this.proxies[proxyIndex] = message.label;
        }
        tableData[index] = message;
        this.setTableData(tableData);
        this.panelObj[itemLabel].dispose();
        this.refresh();
      }, null, context.subscriptions);
    } else {
      this.panelObj[itemLabel].reveal();
    }
  }

  run(treeItem?: TableItem): void {
    let tableData = this.getTableData();

    if (treeItem) {
      this.proxies.push(treeItem.label);
    }

    this.refresh();

    if(this.server) {
      this.server.close();
      this.server = undefined;
    }

    if (!this.proxies.length) {return;}

    this.app = new Koa();

    this.proxies.forEach(label => {
      let tableItem = tableData.find(item => item.label === label);
      if(!tableItem) {return;}
      let options = {};
      Object.keys(tableItem).forEach(pro => {
        if(!['location', 'label'].includes(pro)) {
          (options as any)[pro] = (tableItem as any)[pro];
        }
      });
      this.app.use(async (ctx, next) => {
        ctx.respond = false; // 绕过koa内置对象response ，写入原始res对象，而不是koa处理过的response
        await k2c(httpProxy((tableItem as TableItemData).location, options))(ctx, next);
      });
    });
    
    this.server = this.app.listen(62000);
  }

  pause(treeItem: TableItem): void {
    let index = this.proxies.findIndex(label => label === treeItem.label);
    this.proxies.splice(index, 1);
    this.run();
  }

  moveTop(treeItem: TableItem): void {
    let tableData = this.getTableData();
    let itemData = tableData.splice(tableData.findIndex(item => item.label === treeItem.label), 1);
    tableData.unshift(...itemData);
    this.setTableData(tableData);
    this.refresh();
  }
  moveUp(treeItem: TableItem): void {
    let tableData = this.getTableData();
    let index = tableData.findIndex(item => item.label === treeItem.label);
    if (index === 0) {return;}
    let tmp = tableData[index];
    tableData[index] = tableData[index - 1];
    tableData[index - 1] = tmp;
    this.setTableData(tableData);
    this.refresh();
  }
  moveDown(treeItem: TableItem): void {
    let tableData = this.getTableData();
    let index = tableData.findIndex(item => item.label === treeItem.label);
    if (index === tableData.length - 1) { return; }
    let tmp = tableData[index];
    tableData[index] = tableData[index + 1];
    tableData[index + 1] = tmp;
    this.setTableData(tableData);
    this.refresh();
  }
}

class TableItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    private status: TableItemStatus
  ) {
    super(label, collapsibleState);
  }

  get tooltip(): string {
    return this.label;
  }

  get description(): string {
    return this.status === TableItemStatus.Run ? 'running' : '';
  }

  get contextValue(): string {
    return this.status;
  }

  public setStatus(value: TableItemStatus): void {
    this.status = value;
  }

  get command(): vscode.Command {
    return {
      command: 'proxyTable.openWebview',
      title: 'Open Edit Page',
      arguments: [this]
    };
  }
}

enum TableItemStatus {
  Run = 'run',
  Pause = 'pause'
}

interface TableItemData {
  label: string
  location: string
  target: string
  timeout: number
  pathRewrite: {
    [proName: string]: string
  }
}

function getWebviewContent(tableItemData: TableItemData): string {
  // return fs.readFileSync(path.resolve(__dirname, './webview.html'), 'utf8');
  let pathRewriteNode = Object.keys(tableItemData.pathRewrite).map(v => {
    return `<li><input value="${v}"/>&nbsp;:&nbsp;<input value="${tableItemData.pathRewrite[v]}"/></li>`;
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Simple Proxy</title>
  <style>
    ul {
      padding: 0;
    }
    ul li {
      list-style: none;
    }
    input{
      padding: 4px 10px;
      border: 0;
      color: #fff;
      background: #333;
    }
    .container {
      margin: 20px;
      border-top: 1px solid;
      border-bottom: 1px solid;
    }
    .container .item {
      display: flex;
      margin: 10px 0;
    }
    .container li label{
      width: 100px;
    }
    
    .container li .path-rewrite-block {
    }

    button {
      padding: 6px 16px;
      background: #007acc;
      border-radius: 2px;
      color: #fff;
      cursor: pointer;
    }
  </style>
</head>
<body>
<h3><input id="label" value="${tableItemData.label}"></input></h3>
  <ul class="container">
    <li class="item"><label>location</label><input id="location" value="${tableItemData.location}"/><br></li>
    <li class="item"><label>target</label><input id="target" value="${tableItemData.target}"/></li>
    <li class="item"><label>timeout</label><input id="timeout" value="${tableItemData.timeout}"/></li>
    <li class="item"><label>path rewrite</label><ul class="path-rewrite-block" id="pathRewrite">${pathRewriteNode}</ul></li>
  </ul>
  <button id="save">Save</button>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelector('#save').onclick = function() {
      let label = document.querySelector('#label').value;
      let location = document.querySelector('#location').value;
      let target = document.querySelector('#target').value;
      let timeout = +(document.querySelector('#timeout').value);
      let pathRewrite = {};
      document.querySelectorAll('#pathRewrite li').forEach(node => {
        let inputNodes = node.querySelectorAll('input');
        console.log(inputNodes)
        pathRewrite[inputNodes[0].value] = inputNodes[1].value;
      });
      let message = {
        label,
        location,
        target,
        timeout,
        pathRewrite
      };
      vscode.postMessage(message);
    }
  </script>

</body>
</html>`;
}
