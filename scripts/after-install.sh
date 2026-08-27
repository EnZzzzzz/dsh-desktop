#!/bin/bash
# Custom deb postinst: same as electron-builder's default, but ALWAYS sets the
# SUID bit on chrome-sandbox. The default only chmods 4755 when user namespaces
# are unavailable, but on Ubuntu 23.10+ (kernel.apparmor_restrict_unprivileged_
# userns=1) unprivileged userns is blocked for unconfined apps even though the
# kernel supports it — Electron then aborts demanding a setuid helper.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/dsh-desktop' -a -e '/usr/bin/dsh-desktop' -a "`readlink '/usr/bin/dsh-desktop'`" != '/etc/alternatives/dsh-desktop' ]; then
        rm -f '/usr/bin/dsh-desktop'
    fi
    update-alternatives --install '/usr/bin/dsh-desktop' 'dsh-desktop' '/opt/dsh-desktop/dsh-desktop' 100 || ln -sf '/opt/dsh-desktop/dsh-desktop' '/usr/bin/dsh-desktop'
else
    ln -sf '/opt/dsh-desktop/dsh-desktop' '/usr/bin/dsh-desktop'
fi

# Always use the SUID chrome-sandbox (works with and without user namespaces).
chmod 4755 '/opt/dsh-desktop/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
