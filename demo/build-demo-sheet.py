# Builds demo/demo-inventory.xlsx: a made-up inventory sheet for demoing the Google Sheets sync.
# Upload it to Google Drive (it converts to a Google Sheet), share it with the service account, set GOOGLE_SHEET_ID.
# Mostly clean rows, plus a few deliberately messy ones so the "Sync issues" tab has something to show.
# Run: python3 demo/build-demo-sheet.py
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

TIRE_HEAD = ['Size', 'Brand', 'Model', 'Type', 'N/U', 'Tread', 'Load/Speed', 'DOT', 'Qty', 'Price', 'Location', 'Notes']
TIRES = [
    # Subaru Outback / Forester, CR-V, RAV4 sizes, so vehicle searches have stock
    ['225/65R17', 'Michelin', 'X-Ice Snow SUV', 'Winter', 'N', '', '102T', '2525', 8, 229, 'Rack B-04', ''],
    ['225/65R17', 'Bridgestone', 'Blizzak DM-V2', 'Winter', 'N', '', '102S', '1825', 4, 214, 'Rack B-05', ''],
    ['225/65R17', 'Michelin', 'CrossClimate2 SUV', 'All weather', 'N', '', '102H', '3124', 4, 259, 'Rack B-06', ''],
    ['225/65R17', 'Continental', 'CrossContact LX25', 'All season', 'U', '7/32', '102H', '2022', 4, 75, 'Used U-11', 'light plug in one'],
    ['225/60R18', 'Nokian', 'Hakkapeliitta R5 SUV', 'Winter', 'N', '', '104R XL', '2025', 4, 279, 'Rack C-02', ''],
    ['225/60R18', 'Toyo', 'Celsius II', 'All weather', 'N', '', '100H', '0825', 4, 219, 'Rack C-03', ''],
    ['235/65R17', 'Michelin', 'Defender LTX M/S2', 'All season', 'N', '', '104T', '2024', 0, 262, 'Rack C-06', 'on order'],
    ['235/65R17', 'General', 'Altimax Arctic 12', 'Winter', 'N', '', '108T XL', '3625', 4, 189, 'Rack C-07', ''],
    ['225/65R17', 'General', 'Altimax Arctic 12', 'Winter', 'U', '8/32', '102T', '4721', 2, 65, 'Used U-12', ''],
    # Civic / Corolla / Elantra sizes
    ['205/55R16', 'Pirelli', 'Ice Zero FR', 'Winter', 'N', '', '91T', '0525', 8, 159, 'Rack A-05', ''],
    ['205/55R16', 'Bridgestone', 'Turanza QuietTrack', 'All season', 'U', '4/32', '91V', '1519', 2, 45, 'Used U-01', 'sell cheap'],
    ['215/55R16', 'Toyo', 'Observe GSi-6', 'Winter', 'U', '9/32', '97H XL', '2224', 4, 140, 'Used U-07', 'off a 2023 Civic'],
    ['215/50R17', 'Michelin', 'X-Ice Snow', 'Winter', 'N', '', '95H XL', '2925', 4, 209, 'Rack A-09', ''],
    ['235/40R18', 'Continental', 'VikingContact 7', 'Winter', 'N', '', '95T XL', '1125', 4, 239, 'Rack A-12', ''],
    ['195/65R15', 'Firestone', 'WinterForce 2', 'Winter', 'N', '', '91S', '3324', 8, 119, 'Rack A-02', ''],
    # Trucks
    ['265/70R17', 'Goodyear', 'Wrangler Workhorse AT', 'All season', 'N', '', '115T', '2024', 4, 269, 'Yard 1', ''],
    ['275/65R18', 'BFGoodrich', 'All-Terrain T/A KO2', 'All season', 'N', '', '123/120S', '1925', 5, 389.99, 'Yard 1', ''],
    ['LT245/75R16', 'Cooper', 'Discoverer AT3 LT', 'All season', 'N', '', '120/116S', '0725', 4, 279, 'Yard 2', ''],
    ['275/60R20', 'Michelin', 'LTX Winter', 'Winter', 'N', '', '115T', '3925', 4, 349, 'Yard 3', ''],
    # Messy on purpose: how staff really type, to show the cleaner and the Sync issues tab
    ['225 65 17', 'Nokian', 'One', 'all-season', 'new', '', '102H', '2325', 4, '$1,036/set', 'Rack B-08', 'typed with spaces, set price'],
    ['31x10.50R15', 'BFGoodrich', 'Mud-Terrain KM3', 'MT', 'N', '', '109Q', '2024', 4, 420, 'Yard 2', 'flotation size: not synced'],
    ['265/70R17', 'Falken', 'Wildpeak AT3W', 'All terrain', 'N', '', '115T', '2025', 'four', 289, 'Yard 1', 'qty typed as a word: not synced'],
]

WHEEL_HEAD = ['Description', 'Size', 'Offset', 'Bolt Pattern', 'CB', 'Condition', 'Grade', 'Qty', 'Price', 'Location']
WHEELS = [
    ['Steel winter wheel black', '17x7', 'ET39', '5x114.3', '60.1', 'New', '', 8, 89, 'Wheel W-01'],
    ['Steel winter wheel', '16x6.5', '+45', '5x114.3', '64.1', 'New', '', 8, 79, 'Wheel W-02'],
    ['Steel winter wheel', '17x7', '48', '5x100', '56.1', 'New', '', 8, 89, 'Wheel W-03'],
    ['Steel winter wheel', '15x6', '40', '5x100', '54.1', 'New', '', 4, 69, 'Wheel W-04'],
    ['Alloy winter wheel silver', '18x7.5', '48', '5x114.3', '56.1', 'New', '', 8, 179, 'Rack W-10'],
    ['Aftermarket 5-spoke gloss gunmetal', '17x7.5', '40', '5x100/5x114.3', '73.1', 'New', '', 8, 189, 'Rack W-20'],
    ['Honda CR-V OEM alloy, 2 with rash', '18x7.5', '45', '5x114.3', '64.1', 'Used', 'C', 4, 239, 'Used A-07'],
    ['Subaru Outback OEM alloy gunmetal', '18x7', '48', '5x114.3', '56.1', 'Used', 'A', 4, 329, 'Used A-05'],
    ['Toyota RAV4 OEM alloy', '17x7', '35', '5x114.3', '60.1', 'Used', 'B', 4, 259, 'Used A-08'],
    ['Ford F-150 OEM alloy machined', '18x7.5', '44', '6x135', '87.1', 'Used', 'B', 4, '$1100/set', 'Used A-12'],
    ['Chevy Silverado steel', '17x7.5', '31', '6x5.5', '78.1', 'Used', 'B', 4, 60, 'Wheel W-14'],
    ['Old Jeep alloys', '', '', '5x4.5', '', 'Used', '', 4, 50, 'Yard 3'],   # no size: not synced
]

def sheet(ws, title, head, rows):
    ws.append([title])
    ws['A1'].font = Font(bold=True, size=12)
    ws.append(head)
    for c in ws[2]:
        c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='E8F0E8')
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=3):
        for c in row:
            if isinstance(c.value, str): c.number_format = '@'   # keep "0525", "17x7" as text
    ws.freeze_panes = 'A3'
    for i, h in enumerate(head):
        width = max(len(str(h)), *(len(str(r[i])) for r in rows)) + 2
        ws.column_dimensions[chr(65 + i)].width = min(width, 40)

wb = Workbook()
sheet(wb.active, 'DEMO INVENTORY: made-up sample stock for testing the counter, not real', TIRE_HEAD, TIRES)
wb.active.title = 'Tires'
sheet(wb.create_sheet('Wheels'), 'DEMO WHEELS: made-up sample stock', WHEEL_HEAD, WHEELS)
out = Path(__file__).with_name('demo-inventory.xlsx')
wb.save(out)
print(out, out.stat().st_size, 'bytes')
