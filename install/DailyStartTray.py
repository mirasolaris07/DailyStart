from pystray import Icon, Menu, MenuItem
from PIL import Image, ImageDraw
import subprocess
import webbrowser
import os
import signal
import sys

# --- Path Logic ---
# Script is in install/, App root is parent
INSTALL_DIR = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(INSTALL_DIR)
PORT = 3000
APP_NAME = "DailyStart"
LOG_FILE = os.path.join(APP_ROOT, "app.log")

def create_image():
    width = 64
    height = 64
    image = Image.new('RGB', (width, height), "white")
    dc = ImageDraw.Draw(image)
    dc.ellipse([10, 10, 54, 54], fill="orange")
    return image

def on_open(icon, item):
    webbrowser.open(f"http://localhost:{PORT}")

def on_quit(icon, item):
    try:
        subprocess.run(["pkill", "-f", "tsx server.ts"], check=False)
    except Exception as e:
        print(f"Error stopping process: {e}")
    icon.stop()
    sys.exit(0)

def start_server():
    try:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', PORT)) == 0:
                print(f"Port {PORT} is busy - Google Auth may fail.")
                return
    except:
        pass

    with open(LOG_FILE, "a") as log:
        # Run npm run dev in the APP_ROOT
        subprocess.Popen(["npm", "run", "dev"], stdout=log, stderr=log, preexec_fn=os.setpgrp, cwd=APP_ROOT)

# Initialize
start_server()

icon = Icon(APP_NAME, create_image(), menu=Menu(
    MenuItem("Open Dashboard", on_open),
    MenuItem("Quit", on_quit)
))

print(f"{APP_NAME} Tray Icon started via {os.path.basename(__file__)}")
icon.run()
