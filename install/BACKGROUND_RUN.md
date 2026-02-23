# 🚀 DailyStart Background Service & Tray Manager

All installation scripts are located in the `install/` directory.

---

## 🪟 Windows: Managed Background Run

### 1. Start the Manager
To launch the background server and the tray icon simultaneously, run:
```powershell
# powershell -ExecutionPolicy Bypass -File install/DailyStartTray.ps1
Start-Process powershell -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File install/DailyStartTray.ps1"
```

### 2. Auto-Start at Login (Recommended)
To make it start automatically whenever you turn on your PC, run this command in **PowerShell (Admin)** from the project root:
```powershell
$TaskName = "DailyStart_Background"; $Path = (Get-Location).Path; $Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Path\install\DailyStartTray.ps1`"" -WorkingDirectory $Path; $Trigger = New-ScheduledTaskTrigger -AtLogOn; Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Force
```

---

## 🐧 Linux: Managed Background Run

### 1. Requirements
Install the system tray library for Python:
```bash
pip install pystray Pillow
```

### 2. Start the Manager
Run the script to start the server in the background and show the icon:
```bash
python3 install/DailyStartTray.py &
```

### 3. Auto-Start (GNOME/KDE/XFCE)
Add this command to your **Startup Applications**:
`python3 /path/to/DailyStart/install/DailyStartTray.py`

---

## 🛠️ Global Configuration
You can change the port in your `.env` file:
```env
PORT=3000
```
