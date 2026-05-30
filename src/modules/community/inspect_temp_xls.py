import xlrd
import sys

file_path = r"C:\Users\HPP\.gemini\antigravity-ide\brain\272fce84-9580-499f-86e2-61f8422a9ba9\scratch\test_out.xls"
out_path = r"C:\Users\HPP\.gemini\antigravity-ide\brain\272fce84-9580-499f-86e2-61f8422a9ba9\scratch\xls_temp_structure.txt"

workbook = xlrd.open_workbook(file_path)

with open(out_path, "w", encoding="utf-8") as f:
    f.write("Sheet Names: " + str(workbook.sheet_names()) + "\n")
    
    for sheet_name in workbook.sheet_names():
        sheet = workbook.sheet_by_name(sheet_name)
        f.write(f"\n--- Sheet: {sheet_name} (Rows: {sheet.nrows}, Cols: {sheet.ncols}) ---\n")
        
        for rx in range(min(50, sheet.nrows)):
            row = sheet.row_values(rx)
            formatted_row = [str(val).strip() if val is not None else "" for val in row]
            f.write(f"Row {rx:02d}: {formatted_row}\n")

print("Inspection output written to", out_path)
