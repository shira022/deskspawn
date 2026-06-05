# Installation

Download the latest release from
[GitHub Releases](https://github.com/shira022/deskspawn/releases/latest).

> DeskSpawn is **unsigned** for all platforms. Your operating system may show a
> security warning — this is normal. Instructions to bypass are provided below.

---

## Windows

### Requirements
- Windows 10 or later (64-bit)

### Steps
1. Download the `.msi` installer from the
   [latest release](https://github.com/shira022/deskspawn/releases/latest).
2. Double-click the `.msi` file to launch the installer.
3. If **Windows SmartScreen** blocks the app:
   - Click **More info** on the warning dialog.
   - Click **Run anyway**.
4. Follow the setup wizard. DeskSpawn will be installed to your
   `Program Files` directory and added to the Start Menu.

> The app is unsigned because it is open-source and distributed under the MIT
> license. You can verify the build integrity by building from source or
> checking the SHA checksums published alongside each release.

---

## macOS

### Requirements
- macOS 10.15 (Catalina) or later
- Apple Silicon (M1/M2/M3) or Intel processor

### Steps
1. Download the `.dmg` file from the
   [latest release](https://github.com/shira022/deskspawn/releases/latest).
2. Open the `.dmg` file.
3. Drag the **DeskSpawn** icon into the **Applications** folder.
4. **First launch:** because the app is not notarised, Gatekeeper will block it.
   - Right-click (or Ctrl-click) **DeskSpawn** in the Applications folder.
   - Select **Open** from the context menu.
   - Click **Open** in the confirmation dialog.
   - You only need to do this once — subsequent launches work normally.

---

## Linux

### Requirements
- Ubuntu 20.04+ or equivalent (Debian-based distribution)
- Other distributions: use the `.AppImage` (see below)

### Option A: Debian / Ubuntu (.deb)

```bash
# Download the .deb package
wget https://github.com/shira022/deskspawn/releases/latest/download/deskspawn_amd64.deb

# Install it
sudo dpkg -i deskspawn_amd64.deb

# If there are missing dependencies
sudo apt-get install -f
```

After installation, launch DeskSpawn from your application menu or run
`deskspawn` in the terminal.

### Option B: AppImage

```bash
# Download the .AppImage
wget https://github.com/shira022/deskspawn/releases/latest/download/deskspawn-x86_64.AppImage

# Make it executable
chmod +x deskspawn-x86_64.AppImage

# Run it
./deskspawn-x86_64.AppImage
```

> **Tip:** Move the `.AppImage` to a permanent location (e.g. `~/Applications/`)
> and create a desktop shortcut for easy access.

---

## Verifying Your Installation

Once installed, launch DeskSpawn. You should see the welcome screen. If the
sidecar fails to start, check the
[Sidecar Troubleshooting guide](./usage/sidecar.md).

---

## System Requirements (All Platforms)

| Component | Minimum              | Recommended            |
|-----------|----------------------|------------------------|
| OS        | See platform above   | Latest stable release  |
| CPU       | Dual-core, 2.0 GHz   | Quad-core, 2.5 GHz+   |
| RAM       | 4 GB                 | 8 GB                   |
| Disk      | 200 MB free          | 1 GB free              |
| Network   | Broadband (for AI)   | Broadband (for AI)     |

---

## Building from Source

If you prefer to build the app yourself, clone the repository and follow the
instructions in the `README.md` at
[github.com/shira022/deskspawn](https://github.com/shira022/deskspawn).
