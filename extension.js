const vscode = require("vscode");

function activate(context) {
  console.log("Calcula BLKSIZE: Activating extension...");

  try {
    // Comando principal: Calcular BLKSIZE
    let calculateCommand = vscode.commands.registerCommand(
      "cobol-blksize.calculate",
      async function () {
        const panel = vscode.window.createWebviewPanel(
          "cobolcalculablksize",
          "Calculadora BLKSIZE",
          vscode.ViewColumn.Two,
          {
            enableScripts: true,
          }
        );

        panel.webview.html = getWebviewContent();

        // Manejar mensajes desde el webview
        panel.webview.onDidReceiveMessage(
          (message) => {
            switch (message.command) {
              case "showResults":
                vscode.window.showInformationMessage(
                  `BLKSIZE: ${message.data.blksize} | Cilindros: ${message.data.cylinders}`
                );
                return;
              case "copyJCL":
                vscode.env.clipboard.writeText(message.data);
                vscode.window.showInformationMessage(
                  "JCL copiado al portapapeles"
                );
                return;
            }
          },
          undefined,
          context.subscriptions
        );
      }
    );

    // Comando: Insertar JCL con input rápido
    let insertJCLCommand = vscode.commands.registerCommand(
      "cobol-blksize.insertJCL",
      async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        const selection = editor.selection;
        const document = editor.document;
        const selectedText = document.getText(selection);
        const position = editor.selection.active;
        const lineText = editor.document.lineAt(position.line).text;
        const hasBlksize = lineText.includes("BLKSIZE=");
        const upperSelected = selectedText.toUpperCase();
        const upperLine = lineText.toUpperCase();
        const hasBlksizeInSelection =
          selectedText && upperSelected.includes("BLKSIZE=");
        const hasBlksizeInLine = upperLine.includes("BLKSIZE=");

        // === MODO RÁPIDO: solo BLKSIZE usando LRECL detectado ===
        if (hasBlksizeInSelection || hasBlksizeInLine) {
          const contextText =
            selectedText && selectedText.length > 0 ? selectedText : lineText;

          // Detectar LRECL del contexto (ej: "LRECL=537,BLKSIZE=)")
          let lreclValue = null;
          const lreclMatch = contextText.match(/LRECL\s*=\s*(\d+)/i);
          if (lreclMatch) {
            lreclValue = parseInt(lreclMatch[1], 10);
          }

          // Detectar RECFM del contexto (ej: "RECFM=FB")
          let recfmValue = null;
          const recfmMatch = contextText.match(/RECFM\s*=\s*([A-Z]+)/i);
          if (recfmMatch) {
            recfmValue = recfmMatch[1].toUpperCase();
          }

          // Si no se puede detectar, se le pide al usuario
          if (!lreclValue) {
            const lreclInput = await vscode.window.showInputBox({
              prompt: "Ingresa el LRECL (largo del registro)",
              placeHolder: "80",
              validateInput: (text) => {
                return isNaN(text) || parseInt(text) <= 0
                  ? "Debe ser un número positivo"
                  : null;
              },
            });

            if (!lreclInput) return;
            lreclValue = parseInt(lreclInput, 10);
          }

          // Si no se detectó RECFM, pedirlo
          let recfm = recfmValue;
          if (!recfm) {
            recfm = await vscode.window.showQuickPick(
              ["FB", "FBS", "VB", "VBS"],
              {
                placeHolder: "Selecciona el formato de registro (RECFM)",
              }
            );
            if (!recfm) return;
          }

          const results = calculateBlksize(lreclValue, 1, recfm);

          await editor.edit((editBuilder) => {
            if (hasBlksizeInSelection) {
              const newText = selectedText.replace(
                /(BLKSIZE\s*=\s*)(\d*)/i,
                `$1${results.optimalBlksize}`
              );
              editBuilder.replace(selection, newText);
            } else if (hasBlksizeInLine) {
              const line = document.lineAt(selection.active.line);
              const newLine = line.text.replace(
                /(BLKSIZE\s*=\s*)(\d*)/i,
                `$1${results.optimalBlksize}`
              );
              editBuilder.replace(line.range, newLine);
            }
          });

          vscode.window.showInformationMessage(
            `BLKSIZE calculado e insertado: ${results.optimalBlksize}`
          );
          return;
        }

        // === MODO ORIGINAL: insertar JCL completo (con prompts completos) ===
        const lreclInput = await vscode.window.showInputBox({
          prompt: "Ingresa el LRECL (largo del registro)",
          placeHolder: "80",
          validateInput: (text) => {
            return isNaN(text) || parseInt(text) <= 0
              ? "Debe ser un número positivo"
              : null;
          },
        });

        if (!lreclInput) return;
        const lreclValue = parseInt(lreclInput, 10);

        const numRecords = await vscode.window.showInputBox({
          prompt:
            "Ingresa la cantidad de registros estimada (opcional, default: 1)",
          placeHolder: "10000",
          validateInput: (text) => {
            if (!text) return null;
            return isNaN(text) || parseInt(text) <= 0
              ? "Debe ser un número positivo"
              : null;
          },
        });

        const recordCountValue = numRecords ? parseInt(numRecords) : 1;

        const recfm = await vscode.window.showQuickPick(
          ["FB", "FBS", "VB", "VBS"],
          {
            placeHolder: "Selecciona el formato de registro (RECFM)",
          }
        );
        if (!recfm) return;

        const results = calculateBlksize(lreclValue, recordCountValue, recfm);
        const jcl = generateJCL(String(lreclValue), recfm, results);

        await editor.edit((editBuilder) => {
          editBuilder.insert(position, jcl);
        });

        vscode.window.showInformationMessage(
          `JCL insertado - BLKSIZE: ${results.optimalBlksize}, CYL: (${results.primaryQty},${results.secondaryQty})`
        );
      }
    );

    context.subscriptions.push(calculateCommand);
    context.subscriptions.push(insertJCLCommand);

    console.log("Calcula BLKSIZE: Activation successful.");
  } catch (error) {
    console.error("Calcula BLKSIZE: Activation FAILED", error);
    vscode.window.showErrorMessage(
      `Error activando extensión Calcula BLKSIZE: ${error.message}`
    );
  }
}

function calculateBlksize(recordLength, recordCount, recfm) {
  const maxBlksize = 27966; // Límite máximo para z/OS
  const trackCapacity = 56664; // Capacidad track 3390
  const blockOverhead = 12; // Overhead por bloque

  let optimalBlksize;
  let blocksPerTrack;

  if (recfm === "FB" || recfm === "FBS") {
    // Fórmula: BLKSIZE = TRUNCAR(TRUNCAR(27966/LRECL) * LRECL)
    const recsPerBlock = Math.floor(maxBlksize / recordLength);
    optimalBlksize = recsPerBlock * recordLength;
    blocksPerTrack = Math.floor(
      trackCapacity / (optimalBlksize + blockOverhead)
    );
  } else {
    optimalBlksize = Math.min(recordLength + 4, maxBlksize);
    blocksPerTrack = Math.floor(
      trackCapacity / (optimalBlksize + blockOverhead)
    );
  }

  const recordsPerBlock = Math.floor(optimalBlksize / recordLength);
  const totalBlocks = Math.ceil(recordCount / recordsPerBlock);

  const totalBytes = recordCount * recordLength;
  const totalKB = (totalBytes / 1024).toFixed(2);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

  const tracksNeeded = Math.ceil(totalBlocks / blocksPerTrack);
  const cylindersNeeded = Math.ceil(tracksNeeded / 15);
  const cylindersWithMargin = Math.ceil(cylindersNeeded * 1.2);

  const primaryQty = Math.max(1, Math.ceil(cylindersNeeded * 0.8));
  const secondaryQty = Math.max(1, Math.ceil(cylindersNeeded * 0.2));

  return {
    optimalBlksize,
    recordsPerBlock,
    totalBlocks,
    blocksPerTrack,
    totalKB,
    totalMB,
    tracksNeeded,
    cylindersNeeded,
    cylindersWithMargin,
    primaryQty,
    secondaryQty,
  };
}

function generateJCL(lrecl, recfm, results) {
  return `//DATASET  DD DSN=DXXX.NW.XXXX,
//             DISP=(NEW,CATLG),UNIT=SYSDA,
//             SPACE=(CYL,(${results.primaryQty},${results.secondaryQty}),RLSE),
//             DCB=(RECFM=${recfm},LRECL=${lrecl},BLKSIZE=${results.optimalBlksize})
`;
}

function getWebviewContent() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Calculadora de BLKSIZE</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: var(--vscode-foreground);
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 10px;
        }
        .input-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        input, select {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 20px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 14px;
            margin-right: 10px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .results {
            margin-top: 30px;
            display: none;
        }
        .result-section {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 4px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .result-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 10px;
        }
        .result-item {
            background: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 4px;
        }
        .result-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .result-value {
            font-size: 20px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .note {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧮 Calculo BLKSIZE y Espacio // BECH-CCASTI10 </h1>

        <div class="input-group">
            <label for="lrecl">LRECL (Largo del Registro):</label>
            <input type="number" id="lrecl" placeholder="Ej: 80, 133, 500">
        </div>

        <div class="input-group">
            <label for="numRecords">Cantidad de Registros (opcional, default: 1):</label>
            <input type="number" id="numRecords" placeholder="Ej: 10000, 1000000 (opcional)">
        </div>

        <div class="input-group">
            <label for="recfm">RECFM (Formato):</label>
            <select id="recfm">
                <option value="FB">FB - Fixed Block</option>
                <option value="FBS">FBS - Fixed Block Standard</option>
                <option value="VB">VB - Variable Block</option>
                <option value="VBS">VBS - Variable Block Spanned</option>
            </select>
        </div>

        <button onclick="calculate()">Calcular</button>
        <button onclick="copyJCL()">Copiar JCL</button>

        <div id="results" class="results">
            <div class="result-section">
                <h2>📊 Parámetros Óptimos de Dataset</h2>
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">BLKSIZE Óptimo</div>
                        <div class="result-value" id="blksize">-</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Registros/Bloque</div>
                        <div class="result-value" id="recsPerBlock">-</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Bloques/Track</div>
                        <div class="result-value" id="blocksPerTrack">-</div>
                    </div>
                </div>
            </div>

            <div class="result-section">
                <h2>💾 Requerimientos de Almacenamiento</h2>
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">Espacio Total</div>
                        <div class="result-value" id="totalSpace">-</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Tracks Necesarios</div>
                        <div class="result-value" id="tracks">-</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Cilindros Mínimos</div>
                        <div class="result-value" id="cylinders">-</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">Con Margen (20%)</div>
                        <div class="result-value" id="cylindersMargin">-</div>
                    </div>
                </div>
            </div>

            <div class="result-section">
                <h2>📝 JCL Sugerido</h2>
                <pre id="jclOutput"></pre>
                <div class="note">
                    <strong>💡 Notas:</strong>
                    <ul>
                        <li>BLKSIZE calculado para Mainframe OS/Z 3390 (máximo: 27966)</li>
                        <li>Se incluye RLSE para liberar espacio no utilizado</li>
                        <li>Primary/Secondary calculados con distribución 80/20</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentResults = null;

        function calculate() {
            const lrecl = parseInt(document.getElementById('lrecl').value);
            const numRecords = parseInt(document.getElementById('numRecords').value) || 1; // Default 1
            const recfm = document.getElementById('recfm').value;

            if (!lrecl || lrecl <= 0) {
                alert('Por favor ingresa un LRECL válido');
                return;
            }

            const results = calculateBlksize(lrecl, numRecords, recfm);
            currentResults = results;
            displayResults(lrecl, recfm, results);

            vscode.postMessage({
                command: 'showResults',
                data: {
                    blksize: results.optimalBlksize,
                    cylinders: results.cylindersWithMargin
                }
            });
        }

        function calculateBlksize(recordLength, recordCount, recfm) {
            const maxBlksize = 27966; // Límite máximo para z/OS
            const trackCapacity = 56664; // Capacidad track 3390
            const blockOverhead = 12; // Overhead por bloque

            let optimalBlksize;
            let blocksPerTrack;

            if (recfm === 'FB' || recfm === 'FBS') {
                // Fórmula: BLKSIZE = TRUNCAR(TRUNCAR(27966/LRECL) * LRECL)
                const recsPerBlock = Math.floor(maxBlksize / recordLength);
                optimalBlksize = recsPerBlock * recordLength;
                blocksPerTrack = Math.floor(trackCapacity / (optimalBlksize + blockOverhead));
            } else {
                optimalBlksize = Math.min(recordLength + 4, maxBlksize);
                blocksPerTrack = Math.floor(trackCapacity / (optimalBlksize + blockOverhead));
            }

            const recordsPerBlock = Math.floor(optimalBlksize / recordLength);
            const totalBlocks = Math.ceil(recordCount / recordsPerBlock);

            const totalBytes = recordCount * recordLength;
            const totalKB = (totalBytes / 1024).toFixed(2);
            const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

            const tracksNeeded = Math.ceil(totalBlocks / blocksPerTrack);
            const cylindersNeeded = Math.ceil(tracksNeeded / 15);
            const cylindersWithMargin = Math.ceil(cylindersNeeded * 1.2);

            const primaryQty = Math.max(1, Math.ceil(cylindersNeeded * 0.8));
            const secondaryQty = Math.max(1, Math.ceil(cylindersNeeded * 0.2));

            return {
                optimalBlksize,
                recordsPerBlock,
                totalBlocks,
                blocksPerTrack,
                totalKB,
                totalMB,
                tracksNeeded,
                cylindersNeeded,
                cylindersWithMargin,
                primaryQty,
                secondaryQty
            };
        }

        function displayResults(lrecl, recfm, results) {
            document.getElementById('results').style.display = 'block';
            document.getElementById('blksize').textContent = results.optimalBlksize;
            document.getElementById('recsPerBlock').textContent = results.recordsPerBlock;
            document.getElementById('blocksPerTrack').textContent = results.blocksPerTrack;
            document.getElementById('totalSpace').textContent = results.totalMB + ' MB';
            document.getElementById('tracks').textContent = results.tracksNeeded;
            document.getElementById('cylinders').textContent = results.cylindersNeeded;
            document.getElementById('cylindersMargin').textContent = results.cylindersWithMargin;

            const jcl = \`//DATASET  DD DSN=DXXX.NW.XXXXX,
//             DISP=(NEW,CATLG,DELETE),UNIT=SYSDA,
//             SPACE=(CYL,(\${results.primaryQty},\${results.secondaryQty}),RLSE),
//             DCB=(RECFM=\${recfm},LRECL=\${lrecl},BLKSIZE=\${results.optimalBlksize})\`;

            document.getElementById('jclOutput').textContent = jcl;
        }

        function copyJCL() {
            if (!currentResults) {
                alert('Primero calcula los parámetros');
                return;
            }
            const jcl = document.getElementById('jclOutput').textContent;
            vscode.postMessage({
                command: 'copyJCL',
                data: jcl
            });
        }
    </script>
</body>
</html>`;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
