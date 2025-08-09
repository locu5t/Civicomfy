# Civicomfy Bundled Aria2 Binaries

This directory contains pre-built aria2 binaries for platforms that don't typically have aria2 readily available.

## Included Binaries

### Windows
- `windows/x64/aria2c.exe` - Windows 64-bit binary
- `windows/x86/aria2c.exe` - Windows 32-bit binary

### Linux ARM64
- `linux/aarch64/aria2c` - Linux ARM64 binary (Android build, statically linked)

## Platform Support

### ✅ Fully Supported (Bundled)
- **Windows x64/x86** - Official binaries from aria2 releases
- **Linux ARM64** - Official Android build (works on standard Linux ARM64)

### ⚠️ Partially Supported (System Install Required)
- **macOS** - Use `brew install aria2`
- **Linux x86_64** - Use system package manager:
  - Ubuntu/Debian: `sudo apt install aria2`
  - CentOS/RHEL: `sudo yum install aria2` or `sudo dnf install aria2`
  - Arch Linux: `sudo pacman -S aria2`

### 🔄 Automatic Fallback
If aria2 is not available, Civicomfy automatically falls back to the built-in Python downloader.

## Binary Sources

All binaries are official releases from the [aria2 GitHub repository](https://github.com/aria2/aria2/releases):
- Version: 1.37.0
- Release: https://github.com/aria2/aria2/releases/tag/release-1.37.0

## Verification

You can verify the binaries by checking their version:

```bash
# Windows
./windows/x64/aria2c.exe --version

# Linux ARM64  
./linux/aarch64/aria2c --version
```

Expected output should start with:
```
aria2 version 1.37.0
Copyright (C) 2006, 2019 Tatsuhiro Tsujikawa
...
```

## Security

- All binaries are downloaded directly from official aria2 releases
- No modifications have been made to the binaries
- SHA-256 checksums can be verified against the official release page

## File Sizes

- Windows x64: ~5.5 MB
- Windows x86: ~5.2 MB  
- Linux ARM64: ~5.8 MB
- Total package size increase: ~16.5 MB

## License

The aria2 binaries are distributed under the GNU GPL v2+ license.
See the aria2 project for full license details: https://github.com/aria2/aria2