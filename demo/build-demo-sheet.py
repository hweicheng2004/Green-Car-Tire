# Builds demo/demo-inventory.xlsx from demo/demo-inventory.json: made-up stock for demoing the counter and the Sheets sync.
# The JSON is the one source: demo mode (lib/demo.ts) reads it too, so the app's demo and the uploaded sheet match.
# Upload the .xlsx to Google Drive (it converts to a Google Sheet), share it with the service account, set GOOGLE_SHEET_ID.
# Mostly clean rows, plus a few deliberately messy ones so the "Sync issues" tab has something to show.
# Run: python3 demo/build-demo-sheet.py
import json
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

here = Path(__file__).parent
book = json.loads((here / 'demo-inventory.json').read_text())

def cell(v):
    # Quantities and plain prices as numbers, like staff type them; everything else stays text ("0525", "17x7").
    try:
        return int(v) if v.isdigit() else float(v) if v.replace('.', '', 1).isdigit() else v
    except AttributeError:
        return v

wb = Workbook()
wb.remove(wb.active)
for tab, rows in book.items():
    ws = wb.create_sheet(tab)
    head = rows[1]
    numeric = {i for i, h in enumerate(head) if h in ('Qty', 'Price')}
    for r in rows:
        ws.append([cell(v) if i in numeric else v for i, v in enumerate(r)])
    ws['A1'].font = Font(bold=True, size=12)
    for c in ws[2]:
        c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='E8F0E8')
    for row in ws.iter_rows(min_row=3):
        for c in row:
            if isinstance(c.value, str): c.number_format = '@'
    ws.freeze_panes = 'A3'
    for i in range(len(head)):
        width = max(len(r[i]) if i < len(r) else 0 for r in rows[1:]) + 2
        ws.column_dimensions[chr(65 + i)].width = min(width, 40)

out = here / 'demo-inventory.xlsx'
wb.save(out)
print(out, out.stat().st_size, 'bytes')
