// lazy load jsPDF only when PDF export is needed
let jsPDFModule: typeof import("jspdf") | null = null;

async function loadJsPDF() {
  if (!jsPDFModule) {
    jsPDFModule = await import("jspdf");
  }
  return jsPDFModule;
}

interface ComparisonData {
  runA: {
    id: string;
    chain: string;
    goal: string;
    started: string;
    completed?: string;
    status: string;
  };
  runB: {
    id: string;
    chain: string;
    goal: string;
    started: string;
    completed?: string;
    status: string;
  };
  metricsDiff: {
    duration: number;
    durationPercent: number;
    tokens: number;
    tokensPercent: number;
    cost: number;
    costPercent: number;
    agentCount: number;
  };
  perfA?: {
    summary: {
      total_tokens: number;
      total_cost_usd: number;
      total_duration_ms: number;
      total_api_calls: number;
    };
  };
  perfB?: {
    summary: {
      total_tokens: number;
      total_cost_usd: number;
      total_duration_ms: number;
      total_api_calls: number;
    };
  };
}

export function exportComparisonJSON(data: ComparisonData): void {
  const exportData = {
    ...data,
    exportedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comparison-${data.runA.id.slice(-8)}-${data.runB.id.slice(-8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportComparisonPDF(data: ComparisonData): Promise<void> {
  const { default: jsPDF } = await loadJsPDF();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - 2 * margin;
  let y = margin;

  // helper to add text with word wrap
  const addText = (text: string, fontSize: number, x: number, yPos: number): number => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, x, yPos);
    return yPos + (lines.length * fontSize * 0.5) + 3;
  };

  // title
  doc.setFontSize(18);
  doc.text("Run Comparison Report", margin, y);
  y += 12;

  // run ids
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Run A: ${data.runA.id}`, margin, y);
  y += 5;
  doc.text(`Run B: ${data.runB.id}`, margin, y);
  y += 8;

  // line separator
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // metrics section
  doc.setTextColor(0);
  doc.setFontSize(14);
  doc.text("Metrics Comparison", margin, y);
  y += 8;

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  // metrics table
  const durationA = data.perfA?.summary.total_duration_ms ?? 0;
  const durationB = data.perfB?.summary.total_duration_ms ?? 0;
  const tokensA = data.perfA?.summary.total_tokens ?? 0;
  const tokensB = data.perfB?.summary.total_tokens ?? 0;
  const costA = data.perfA?.summary.total_cost_usd ?? 0;
  const costB = data.perfB?.summary.total_cost_usd ?? 0;
  const callsA = data.perfA?.summary.total_api_calls ?? 0;
  const callsB = data.perfB?.summary.total_api_calls ?? 0;

  const metrics = [
    ["Metric", "Run A", "Run B", "Difference"],
    ["Duration", formatDuration(durationA), formatDuration(durationB), formatDuration(Math.abs(data.metricsDiff.duration))],
    ["Tokens", tokensA.toString(), tokensB.toString(), Math.abs(data.metricsDiff.tokens).toString()],
    ["Cost (USD)", `$${costA.toFixed(4)}`, `$${costB.toFixed(4)}`, `$${Math.abs(data.metricsDiff.cost).toFixed(4)}`],
    ["API Calls", callsA.toString(), callsB.toString(), "-"],
  ];

  const colWidth = contentWidth / 4;
  let rowY = y;

  metrics.forEach((row, i) => {
    const isHeader = i === 0;
    if (isHeader) {
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, rowY - 3, contentWidth, 8, "F");
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
    }

    row.forEach((cell, j) => {
      const cellX = margin + j * colWidth + 2;
      doc.text(cell, cellX, rowY);
    });
    rowY += 8;
  });

  y = rowY + 10;

  // check if we need a new page
  if (y > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    y = margin;
  }

  // run details section
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Run Details", margin, y);
  y += 8;

  // run a details
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Run A", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y = addText(`Chain: ${data.runA.chain}`, 9, margin + 5, y);
  y = addText(`Goal: ${data.runA.goal}`, 9, margin + 5, y);
  y = addText(`Started: ${new Date(data.runA.started).toLocaleString()}`, 9, margin + 5, y);
  if (data.runA.completed) {
    y = addText(`Completed: ${new Date(data.runA.completed).toLocaleString()}`, 9, margin + 5, y);
  }
  y = addText(`Status: ${data.runA.status}`, 9, margin + 5, y);

  y += 8;

  // run b details
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Run B", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y = addText(`Chain: ${data.runB.chain}`, 9, margin + 5, y);
  y = addText(`Goal: ${data.runB.goal}`, 9, margin + 5, y);
  y = addText(`Started: ${new Date(data.runB.started).toLocaleString()}`, 9, margin + 5, y);
  if (data.runB.completed) {
    y = addText(`Completed: ${new Date(data.runB.completed).toLocaleString()}`, 9, margin + 5, y);
  }
  y = addText(`Status: ${data.runB.status}`, 9, margin + 5, y);

  y += 8;

  // footer
  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, footerY);

  // save
  doc.save(`comparison-${data.runA.id.slice(-8)}-${data.runB.id.slice(-8)}.pdf`);
}
