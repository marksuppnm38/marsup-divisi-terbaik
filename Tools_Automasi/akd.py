import os
import re
import pdfplumber
import pandas as pd

#=========================================
# FOLDER
#=========================================

BASE_FOLDER = r"F:\AKD"

PDF_FOLDER = BASE_FOLDER

OUTPUT_FOLDER = os.path.join(
    BASE_FOLDER,
    "OUTPUT"
)
HASIL_EXCEL = os.path.join(
    OUTPUT_FOLDER,
    "hasil_akd.xlsx"
)

FAILED_TXT = os.path.join(
    OUTPUT_FOLDER,
    "gagal.txt"
)

LOG_TXT = os.path.join(
    OUTPUT_FOLDER,
    "log.txt"
)

#=========================================

os.makedirs(OUTPUT_FOLDER,exist_ok=True)


def get_field(text,field):

    pattern = rf"{field}\s*:\s*(.+)"

    hasil = re.search(
        pattern,
        text,
        re.IGNORECASE
    )

    if hasil:
        return hasil.group(1).strip()

    return ""


def get_akd(text):

    pattern = r"AKD\s*(\d+)"

    hasil = re.search(pattern,text)

    if hasil:
        return hasil.group(1)

    return ""


def get_kbki(text):

    pattern = r"KBKI\s*:\s*(.+)"

    hasil = re.search(
        pattern,
        text,
        re.IGNORECASE
    )

    if hasil:
        return hasil.group(1).strip()

    return ""



def get_tipe(text):

    text = text.upper()

    if "SET ALAT KESEHATAN" in text:
        return "SET"

    return "INSTRUMEN SATUAN"



#=========================================

files = [
    x for x in os.listdir(PDF_FOLDER)
    if x.lower().endswith(".pdf")
]


total = len(files)

print("="*50)
print(f"TOTAL PDF : {total}")
print("="*50)


hasil_data = []
failed = []


for nomor,file in enumerate(files,start=1):

    path = os.path.join(
        PDF_FOLDER,
        file
    )


    try:

        text = ""


        with pdfplumber.open(path) as pdf:

            #lebih aman ambil halaman 1 dan 2

            pages = []

            if len(pdf.pages) >=1:
                pages.append(
                    pdf.pages[0].extract_text()
                )

            if len(pdf.pages) >=2:
                pages.append(
                    pdf.pages[1].extract_text()
                )

            text = "\n".join(
                [x for x in pages if x]
            )


        akd = get_akd(text)


        data = {

            "TIPE":
            get_tipe(text),

            "AKD":
            f"AKD {akd}",

            "KATEGORI_1":
            get_field(
                text,
                "Kategori Produk"
            ),

            "KATEGORI_2":
            get_field(
                text,
                "Sub Kategori"
            ),

            "KATEGORI_3":
            get_field(
                text,
                "Jenis Produk"
            ),

            "KBKI":
            get_kbki(text),

            "NAMA DAGANG":
            get_field(
                text,
                "Nama Dagang"
            ),

            "PRODUSEN":
            get_field(
                text,
                "Nama Produsen"
            ),

            "FILE":
            file,

            "STATUS":
            "SUCCESS"

        }


        hasil_data.append(data)


        print(
            f"[{nomor}/{total}] SUCCESS --> {file}"
        )


    except Exception as e:

        failed.append(file)

        print(
            f"[{nomor}/{total}] FAILED --> {file}"
        )

        print(e)



#=========================================
# EXCEL
#=========================================

df = pd.DataFrame(hasil_data)

df.to_excel(
    HASIL_EXCEL,
    index=False
)


#=========================================
# FAILED
#=========================================

with open(
    FAILED_TXT,
    "w",
    encoding="utf-8"
) as f:

    for item in failed:

        f.write(
            item+"\n"
        )


#=========================================
# LOG
#=========================================

with open(
    LOG_TXT,
    "w",
    encoding="utf-8"
) as f:

    f.write(
        f"TOTAL PDF : {total}\n"
    )

    f.write(
        f"SUCCESS : {len(hasil_data)}\n"
    )

    f.write(
        f"FAILED : {len(failed)}\n"
    )


print("\n"+"="*50)
print("SELESAI")
print("="*50)

print(
    f"SUCCESS : {len(hasil_data)}"
)

print(
    f"FAILED : {len(failed)}"
)

print("\nOUTPUT :")

print(HASIL_EXCEL)
print(FAILED_TXT)
print(LOG_TXT)

print("="*50)