Write-Host "--- DailyStart Manager Initializing ---"
$LogPath = Join-Path $PSScriptRoot "tray_manager.log"
Start-Transcript -Path $LogPath -Append -Force
Write-Host "Logging to: $LogPath"
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

# --- Helper: Native Bottom-Right UI ---
function Set-WindowToBottomRight($form) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $x = $screen.Width - $form.Width - 10
    $y = $screen.Height - $form.Height - 10
    $form.StartPosition = "Manual"
    $form.Location = New-Object System.Drawing.Point($x, $y)
}

function Show-NativeDialog($title, $message, $isInput = $false) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    Write-Host "Tray: Preparing to show native dialog - $title" -ForegroundColor Cyan
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $title
    $form.Size = New-Object System.Drawing.Size(400, 250)
    $form.Topmost = $true
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.BackColor = [System.Drawing.Color]::White

    $label = New-Object System.Windows.Forms.Label
    $label.Location = New-Object System.Drawing.Point(20, 20)
    $label.Size = New-Object System.Drawing.Size(350, 120)
    $label.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $label.Text = $message
    $form.Controls.Add($label)

    $resultText = $null

    if ($isInput) {
        $textBox = New-Object System.Windows.Forms.TextBox
        $textBox.Location = New-Object System.Drawing.Point(20, 140)
        $textBox.Size = New-Object System.Drawing.Size(350, 30)
        $form.Controls.Add($textBox)

        $okBtn = New-Object System.Windows.Forms.Button
        $okBtn.Location = New-Object System.Drawing.Point(270, 180)
        $okBtn.Size = New-Object System.Drawing.Size(100, 30)
        $okBtn.Text = "Commit"
        $okBtn.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.AcceptButton = $okBtn
        $form.Controls.Add($okBtn)
    }
    else {
        $closeBtn = New-Object System.Windows.Forms.Button
        $closeBtn.Location = New-Object System.Drawing.Point(270, 180)
        $closeBtn.Size = New-Object System.Drawing.Size(100, 30)
        $closeBtn.Text = "Got it"
        $closeBtn.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Controls.Add($closeBtn)
    }

    Set-WindowToBottomRight $form

    Write-Host "Tray: Showing form..." -ForegroundColor Gray
    try {
        $form.Add_Shown({ 
                $form.Activate()
                $form.Focus()
            })
        if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and $isInput) {
            $resultText = $textBox.Text
        }
    }
    catch {
        Write-Host "Tray: Dialog Error - $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host "Tray: Form closed/disposed." -ForegroundColor Gray
    
    $form.Dispose()
    return $resultText
}

# --- Background Polling Logic ---
$LastCommitmentCheckDay = ""
$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = 30000 # 30 seconds
$Timer.add_Tick({
        try {
            # 1. Check for Pending Notifications (Briefings, etc.)
            Write-Host "Tray: Polling for notifications..." -ForegroundColor Gray
            $response = Invoke-RestMethod -Uri "http://localhost:3000/api/notifications/tray" -Method Get -ErrorAction Stop
            if ($response) {
                foreach ($notif in $response) {
                    Write-Host "Tray: Received notification - $($notif.title)" -ForegroundColor Cyan
                    # Using Native Dialog instead of Balloon Tip
                    Show-NativeDialog $notif.title $notif.message
                }
            }

            # 2. Nightly Commitment Check (21:00 / 9:00 PM)
            $now = Get-Date
            $todayStr = $now.ToString("yyyy-MM-dd")
            if ($now.Hour -eq 21 -and $now.Minute -eq 0 -and $LastCommitmentCheckDay -ne $todayStr) {
                Write-Host "Tray: Triggering Nightly Commitment prompt."
                $text = Show-NativeDialog "Nightly Commitment" "What is your primary commitment for tomorrow?`nThis will be added to your Available Tasks." $true
                if ($text) {
                    Write-Host "Tray: Sending commitment to server: $text"
                    $body = @{
                        title       = $text
                        description = "Nightly Commitment captured via System Tray."
                        priority    = 1
                        due_at      = $now.AddDays(1).ToString("yyyy-MM-ddT09:00")
                    } | ConvertTo-Json
                    Invoke-RestMethod -Uri "http://localhost:3000/api/tasks" -Method Post -Body $body -ContentType "application/json" -ErrorAction SilentlyContinue
                    $LastCommitmentCheckDay = $todayStr
                }
            }
        }
        catch {
            Write-Host "Tray: Error in polling loop - $($_.Exception.Message)" -ForegroundColor Red
            # Log to Windows Event Log if possible, or just rely on console for now
        }
    })

Write-Host "--- Manager UI Loop Started ---"
$Timer.Start()
[System.Windows.Forms.Application]::Run()
