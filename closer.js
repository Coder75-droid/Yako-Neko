// closer.js: every window, tab and game close lives here
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const TMP_PREFIX = 'desktoppet_';

function tmpScriptPath(ext) {
    return path.join(
        os.tmpdir(),
        TMP_PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + ext
    );
}

function writeScriptSafe(ext, content) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const p = tmpScriptPath(ext);
        try {
            fs.writeFileSync(p, content);
            return p;
        } catch (error) { /* retry with a fresh name */ }
    }
    return null;
}

function cleanTmpScripts() {
    try {
        const now = Date.now();
        for (const f of fs.readdirSync(os.tmpdir())) {
            if (!f.startsWith(TMP_PREFIX)) continue;
            const full = path.join(os.tmpdir(), f);
            try {
                const st = fs.statSync(full);
                if (now - st.mtimeMs > 10 * 60 * 1000) fs.unlinkSync(full);
            } catch (error) { /* ignore */ }
        }
    } catch (error) { /* ignore */ }
}
cleanTmpScripts();
setInterval(cleanTmpScripts, 10 * 60 * 1000);

function runVbs(body) {
    const p = writeScriptSafe('.vbs', body);
    if (!p) return;
    exec(`cscript //nologo "${p}"`, { windowsHide: true });
}

function guarded(pid, proc, ctx) {
    if (!pid || proc.includes('electron')) return true;
    if (ctx.protectedNames.some(n => n && proc.includes(n))) return true;
    return false;
}

// Single target: windows, foreground sites, games
function closeTarget(target, safeTitle, ctx) {
    try {
        const pid = String(target.pid || '').replace(/[^\d]/g, '');
        const proc = String(target.process || '').toLowerCase();

        if (!pid || proc.includes('electron')) return;
        if (target.kind === 'game' && ctx.BROWSERS.some(b => proc.includes(b))) return;
        if (ctx.protectedNames.some(n => n && proc.includes(n))) return;

        const buf = ctx.getBuffer();

        if (buf && buf.fg && buf.fg.pid && (target.kind === 'fg' || target.isFg)) {
            if (String(buf.fg.pid) !== pid) return;
        }

        if (buf && Array.isArray(buf.wins)) {
            const seen = buf.wins.find(w => String(w.pid) === pid);
            if (seen && seen.process && proc && seen.process !== proc) return;
        }

        if (target.kind === 'tab' || target.kind === 'sweep') {
            closeAllFlaggedTabs(safeTitle, ctx);
            return;
        }

        const safe = String(safeTitle || '').replace(/"/g, '""');
        const isBrowser = ctx.BROWSERS.some(b => proc.includes(b));
        const keys = (target.kind === 'game' || !isBrowser) ? '%{F4}' : '^w';

        let vbs = 'Set s = CreateObject("WScript.Shell")\n';
        vbs += `If s.AppActivate(${pid}) Then\n`;
        vbs += '    WScript.Sleep 150\n';
        vbs += `    s.SendKeys "${keys}"\n`;
        vbs += 'End If\n';

        if (target.kind === 'game') {
            vbs += 'WScript.Sleep 400\n';
            vbs += `s.Run "taskkill /F /PID ${pid} /T", 0, False\n`;
        }

        if (safe) vbs += `WScript.Sleep 250\ns.AppActivate "${safe}"\n`;

        runVbs(vbs);
    } catch (error) {
        console.error('close error:', error.message);
    }
}

// Sweep: every window of every browser, tabs by title OR address bar URL,
// exact match first then normalized pattern match
function closeAllFlaggedTabs(safeTitle, ctx) {
    try {
        const buf = ctx.getBuffer();
        if (!buf || !Array.isArray(buf.wins)) return;

        const pids = [];
        for (const w of buf.wins) {
            const proc = String(w.process || '').toLowerCase();
            if (!proc || !ctx.BROWSERS.some(b => proc.includes(b))) continue;
            if (guarded(w.pid, proc, ctx)) continue;
            const pid = String(w.pid || '').replace(/[^\d]/g, '');
            if (pid && !pids.includes(pid)) pids.push(pid);
        }
        if (!pids.length) return;

        const keywords = (Array.isArray(ctx.sites) ? ctx.sites : [])
            .map(k => String(k || '').toLowerCase().trim())
            .filter(k => k.length);
        if (!keywords.length) return;

        const keywordsNorm = keywords
            .map(k => k.replace(/[^a-z0-9]/g, ''))
            .filter(k => k.length);

        const safe = String(safeTitle || '').replace(/'/g, "''");
        const logPath = path.join(os.tmpdir(), 'desktoppet_sweep.log');

        const lines = [
            'Add-Type -AssemblyName UIAutomationClient',
            'Add-Type -AssemblyName UIAutomationTypes',
            'Add-Type -AssemblyName System.Windows.Forms',
            `$safeTitle = '${safe}'`,
            `$logPath = '${logPath}'`,
            `$pids = @(` + pids.join(',') + `)`,
            `$keywords = @(` + keywords.map(k => `'${k.replace(/'/g, "''")}'`).join(',') + `)`,
            `$keywordsNorm = @(` + keywordsNorm.map(k => `'${k}'`).join(',') + `)`,
            'try {',
            '  $s = New-Object -ComObject WScript.Shell',
            '  $root = [System.Windows.Automation.AutomationElement]::RootElement',
            '  $winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)',
            '  $tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)',
            '  $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)',
            '  foreach ($browserPid in $pids) {',
            '    $p = Get-Process -Id $browserPid -ErrorAction SilentlyContinue',
            '    if ($null -eq $p) { continue }',
            '    $pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$browserPid)',
            '    $andCond = New-Object System.Windows.Automation.AndCondition($pidCond, $winCond)',
            '    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $andCond)',
            '    $hitWins = @()',
            '    foreach ($w in $wins) {',
            '      $found = $false',
            // title pass: exact then normalized
            '      $tabsEl = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)',
            '      foreach ($t in $tabsEl) {',
            '        $nm = $t.Current.Name',
            '        if ($null -eq $nm) { continue }',
            '        $clean = ($nm -replace "^\\(\\d+\\)\\s*", "").ToLower()',
            '        $cleanNorm = $clean -replace "[^a-z0-9]", ""',
            '        foreach ($k in $keywords) {',
            '          if ($clean -like ("*" + $k + "*")) { $found = $true; break }',
            '        }',
            '        if (-not $found) {',
            '          foreach ($kn in $keywordsNorm) {',
            '            if ($cleanNorm -like ("*" + $kn + "*")) { $found = $true; break }',
            '          }',
            '        }',
            '        if ($found) { break }',
            '      }',
            // url pass: exact then normalized
            '      if (-not $found) {',
            '        $edits = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)',
            '        foreach ($e in $edits) {',
            '          $enm = $e.Current.Name',
            '          if ($enm -match "address|search|url") {',
            '            try {',
            '              $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
            '              $val = $vp.Current.Value',
            '              if ($val) {',
            '                $vl = $val.ToLower()',
            '                $vlNorm = $vl -replace "[^a-z0-9]", ""',
            '                foreach ($k in $keywords) {',
            '                  if ($vl -like ("*" + $k + "*")) { $found = $true; break }',
            '                }',
            '                if (-not $found) {',
            '                  foreach ($kn in $keywordsNorm) {',
            '                    if ($vlNorm -like ("*" + $kn + "*")) { $found = $true; break }',
            '                  }',
            '                }',
            '              }',
            '            } catch { }',
            '          }',
            '          if ($found) { break }',
            '        }',
            '      }',
            '      if ($found) { $hitWins += $w }',
            '    }',
            '    if ($hitWins.Count -eq 0) { continue }',
            '    $s.AppActivate([int]$browserPid) | Out-Null',
            '    foreach ($w in $hitWins) {',
            '      try { $w.SetFocus() } catch { }',
            '      Start-Sleep -Milliseconds 200',
            '      $again = $true',
            '      while ($again) {',
            '        $again = $false',
            // url first: exact then normalized
            '        $urlHit = $false',
            '        $edits = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)',
            '        foreach ($e in $edits) {',
            '          $enm = $e.Current.Name',
            '          if ($enm -match "address|search|url") {',
            '            try {',
            '              $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)',
            '              $val = $vp.Current.Value',
            '              if ($val) {',
            '                $vl = $val.ToLower()',
            '                $vlNorm = $vl -replace "[^a-z0-9]", ""',
            '                foreach ($k in $keywords) {',
            '                  if ($vl -like ("*" + $k + "*")) { $urlHit = $true; break }',
            '                }',
            '                if (-not $urlHit) {',
            '                  foreach ($kn in $keywordsNorm) {',
            '                    if ($vlNorm -like ("*" + $kn + "*")) { $urlHit = $true; break }',
            '                  }',
            '                }',
            '              }',
            '            } catch { }',
            '          }',
            '          if ($urlHit) { break }',
            '        }',
            '        if ($urlHit) {',
            "          [System.Windows.Forms.SendKeys]::SendWait('^w')",
            '          Start-Sleep -Milliseconds 250',
            '          $again = $true',
            '          continue',
            '        }',
            // then titles: exact then normalized
            '        $tabsEl = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)',
            '        foreach ($t in $tabsEl) {',
            '          $nm = $t.Current.Name',
            '          if ($null -eq $nm) { continue }',
            '          $clean = ($nm -replace "^\\(\\d+\\)\\s*", "").ToLower()',
            '          $cleanNorm = $clean -replace "[^a-z0-9]", ""',
            '          $hit = $false',
            '          foreach ($k in $keywords) {',
            '            if ($clean -like ("*" + $k + "*")) { $hit = $true; break }',
            '          }',
            '          if (-not $hit) {',
            '            foreach ($kn in $keywordsNorm) {',
            '              if ($cleanNorm -like ("*" + $kn + "*")) { $hit = $true; break }',
            '            }',
            '          }',
            '          if ($hit) {',
            '            try {',
            '              $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)',
            '              $sel.Select()',
            '            } catch {',
            '              try {',
            '                $inv = $t.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)',
            '                $inv.Invoke()',
            '              } catch { }',
            '            }',
            '            Start-Sleep -Milliseconds 200',
            "            [System.Windows.Forms.SendKeys]::SendWait('^w')",
            '            Start-Sleep -Milliseconds 200',
            '            $again = $true',
            '            break',
            '          }',
            '        }',
            '      }',
            '    }',
            '  }',
            "  if ($safeTitle -ne '') { Start-Sleep -Milliseconds 250; $s.AppActivate($safeTitle) | Out-Null }",
            '} catch {',
            '  try { $_.Exception.Message | Set-Content -Path $logPath } catch { }',
            '}'
        ].join('\n');

        const psPath = writeScriptSafe('.ps1', lines);
        if (!psPath) return;
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { windowsHide: true });
    } catch (error) {
        console.error('tab sweep error:', error.message);
    }
}

module.exports = { closeTarget, closeAllFlaggedTabs };