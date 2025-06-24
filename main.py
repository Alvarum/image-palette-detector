"""
Procesa cada imagen del directorio en un hilo separado.
Extrae colores, los ordena por luminosidad y guarda
un JSON y un BMP visual por cada una en la carpeta /export.

Debes tener un entorno virtual con pillow instalado.
"""

from PIL import Image
from json import dump
from pathlib import Path
from threading import Thread

# Extensiones que buscara el programa
VALID_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp"]

# Carpeta actual
folder = Path(".")
export_folder = folder / "export"
export_folder.mkdir(exist_ok=True)

def luminosity(color: tuple[int, int, int]) -> float:
    """
    Calcula la luminosidad de un color, esto se usa para ordenar los
    colores por luminosidad en el json y en la imagen
    """
    r, g, b = color
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def procesar_imagen(img_path: Path) -> None:
    """Procesa una imagen y guarda el JSON y el BMP en /export"""
    try:
        img = Image.open(img_path).convert("RGB")
        pixels = list(img.getdata())
        unique_colors = list(set(pixels))
        sorted_colors = sorted(unique_colors, key=luminosity)

        # formato del json
        palette = {
            "hex": [],
            "rgb": [],
            "css_rgb": []
        }

        for r, g, b in sorted_colors:
            palette["hex"].append(f"#{r:02X}{g:02X}{b:02X}")
            palette["rgb"].append([r, g, b])
            palette["css_rgb"].append(f"rgb({r}, {g}, {b})")

        # Guarda el JSON
        json_path = export_folder / img_path.with_suffix(".json").name
        with open(json_path, "w", encoding="utf-8") as f:
            dump(palette, f, indent=2)

        # Guarda la imagen BMP
        bmp_name = img_path.stem + "_palette.bmp"
        bmp_path = export_folder / bmp_name
        bmp_img = Image.new("RGB", (len(sorted_colors), 1))
        bmp_img.putdata(sorted_colors)
        bmp_img.save(bmp_path)

        print(f"{img_path.name} → export/{json_path.name} + {bmp_path.name}")
    except Exception as e:
        print(f"Error procesando {img_path.name}: {e}")

# Crea y lanza los hilos desgraciados
threads = []
for img_path in folder.iterdir():
    if img_path.suffix.lower() in VALID_EXTENSIONS and img_path.is_file():
        thread = Thread(target=procesar_imagen, args=(img_path,))
        thread.start()
        threads.append(thread)

# Espera a que terminen todos los hilos
for t in threads:
    t.join()

# Termina la weaita
print("Procesamiento completo.")
