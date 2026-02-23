Write-Host "--- DailyStart Manager Initializing ---"
Write-Host "Determining application paths..."

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
$NotifyIcon.Icon = [System.Drawing.SystemIcons]::Information
$NotifyIcon.Text = "DailyStart Service"
$NotifyIcon.Visible = $true

# Path logic for 'install' directory - makes the script agnostic to current working directory
$AppRoot = (Get-Item $PSScriptRoot).Parent.FullName
$VbsPath = Join-Path $PSScriptRoot "launch_silently.vbs"

Write-Host "Script Root: $PSScriptRoot"
Write-Host "App Root:    $AppRoot"
Write-Host "VBS Path:    $VbsPath"

# Context Menu
$ContextMenu = New-Object System.Windows.Forms.ContextMenu
$NotifyIcon.ContextMenu = $ContextMenu

$Header = New-Object System.Windows.Forms.MenuItem("DailyStart Manager")
$Header.Enabled = $false

$OpenItem = New-Object System.Windows.Forms.MenuItem("Open Dashboard")
$OpenItem.add_Click({ Start-Process "http://localhost:3000" })

$StopItem = New-Object System.Windows.Forms.MenuItem("Stop & Exit")
$StopItem.add_Click({ 
        Write-Host "Stopping DailyStart services..."
        # Finding the node process specifically running our server
        Get-Process | Where-Object { $_.CommandLine -like "*tsx server.ts*" } | Stop-Process -Force
        $NotifyIcon.Visible = $false
        [System.Windows.Forms.Application]::Exit() 
        Write-Host "Services stopped. Exiting."
    })

$ContextMenu.MenuItems.Add($Header) | Out-Null
$ContextMenu.MenuItems.Add("-") | Out-Null
$ContextMenu.MenuItems.Add($OpenItem) | Out-Null
$ContextMenu.MenuItems.Add("-") | Out-Null
$ContextMenu.MenuItems.Add($StopItem) | Out-Null

# --- Instance Check ---
Write-Host "Performing instance check..."
$CurrentProcess = [System.Diagnostics.Process]::GetCurrentProcess()
# Look for other PowerShell processes running this specific script
$OtherInstances = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like "*DailyStartTray.ps1*" -and $_.ProcessId -ne $CurrentProcess.Id }
if ($OtherInstances) {
    Write-Host "Warning: Another Tray Manager is already running (PID: $($OtherInstances.ProcessId)). Exiting."
    [System.Windows.Forms.MessageBox]::Show("DailyStart Tray Manager is already running in the background.", "Already Running", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    exit
}

# --- Port Check ---
Write-Host "Checking Port 3000 availability..."
$PortCheck = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($PortCheck) {
    Write-Host "Conflict: Port 3000 is occupied by Process ID $($PortCheck.OwningProcess)."
    $Result = [System.Windows.Forms.MessageBox]::Show("Port 3000 is currently in use.`n`nDailyStart needs this port for Google Login. Would you like to stop the conflicting process and start DailyStart?", "Port Conflict", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    
    if ($Result -eq 'Yes') {
        Write-Host "Attempting to clear Port 3000..."
        Stop-Process -Id $PortCheck.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
    else {
        Write-Host "User chose not to clear port. Server will not be started."
        # We'll still show the tray icon so they can stop it later
    }
}

# --- Start Server ---
$ConfirmPort = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if (-not $ConfirmPort) {
    Write-Host "Port is clear. Starting hidden server..."
    Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`"" -WorkingDirectory $AppRoot
}
else {
    Write-Host "Server NOT started because port 3000 is still occupied."
}

Write-Host "Success: Tray Manager is active."
$NotifyIcon.ShowBalloonTip(3000, "DailyStart", "Tray Manager is active. Right-click the icon for options.", [System.Windows.Forms.ToolTipIcon]::Info)
Write-Host "--- Manager UI Loop Started ---"
[System.Windows.Forms.Application]::Run()
