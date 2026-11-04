# MileWage - Infrastructure Requirements (Status and Feasibility)

Purpose: Defines the hardware, software, accounts, and network requirements for Gate 3 spikes. This document tells all agents what can be done and what cannot be done on the owner's real infrastructure.
Status: AUDITED AND VERIFIED. Feasibility confirmed against live hardware.
Sources: 12-gate3-spike-plan.md, 10-backup-restore-and-ops-spec.md.
Scope: Gate 3 spikes only. Raspberry Pi, external VPS, and secondary phones remain deferred.

---

## 1. Feasibility Matrix

| Item | Requirement | Status | What Can and Cannot Be Done |
|:---:|---|:---:|---|
| 1 | Proxmox VM `milewage-spike` | FEASIBLE | Can be provisioned immediately on local Proxmox host (Core Ultra 7, 64 GB RAM). |
| 2 | Android build machine | FEASIBLE | Coder server (Linuxserver) already has JDK 17, Android SDK, Node 24, and 142 GB disk. |
| 3 | Samsung test phone | FEASIBLE | Samsung Galaxy S24 Ultra (One UI 6.1+, Android 14) is ready for testing. |
| 4 | Mobile data plan | FEASIBLE | Active mobile data plan is operational on the Galaxy S24 Ultra. |
| 5 | Vehicle and road testing | MODIFIED | CANNOT use a car. The owner rides a Yamaha BWs 125 scooter with Quad Lock. |
| 6 | Tailscale HTTPS access | PENDING | Homelab uses native WireGuard. Tailscale requires human account authentication. |
| 7 | Second uncapped VM | FEASIBLE | Can be provisioned on Proxmox if performance baseline is needed. |

---

## 2. Proxmox VM: `milewage-spike` (Feasible)

The local Proxmox hypervisor (<hypervisor>) can provision this capped VM without resource contention.

### Host Hardware
- CPU: Intel Core Ultra 7 265F (20 cores, 20 threads)
- Memory: 64 GB DDR5 (43 GB free and unallocated)
- Storage: NVMe SSD pools (`Main` and `Data-Drive` with over 800 GB free)
- Network: Bridged to LAN (<lan-subnet>) with outbound internet

### Virtual Machine Configuration
- VM ID: Next available ID (for example, 106)
- OS: Debian 12 (Bookworm) minimal installation
- vCPU: 1 core (strict cap for realistic small-host testing)
- RAM: 1024 MB (ballooning disabled)
- Disk: 20 GB VirtIO SCSI on SSD storage
- Disk Cache: Default (No cache) to ensure valid power-loss tests
- Guest Agent: QEMU Guest Agent installed and enabled
- Power Control: Hard stop via root SSH (`qm stop <vmid>`) works from the host shell
- Snapshots: Supported on Proxmox ZFS/directory storage without RAM inclusion

### Software Stack on VM
- Docker Engine and Docker Compose plugin (latest stable)
- Node.js 22.22.0 or newer (to prevent `better-sqlite3` crashes)
- `age` encryption utility (`apt install age`)
- Standard build tools: `build-essential`, `curl`, `git`, `python3`, `util-linux`
- `pmtiles` CLI tool for Spike E

---

## 3. Android Build Machine (Feasible)

The `coder` server (a Proxmox VM, <coder-vm>) is already configured as an Android build environment.

### Installed Toolchains
- JDK: OpenJDK 17.0.20.1
- Android SDK: Installed at `/home/coder/android-sdk` (platforms, build-tools, cmdline-tools, platform-tools, ndk)
- Node.js: v24.15.0
- Storage: 142 GB available on primary volume
- Memory: 16 GB allocated

### USB Deployment Workflow (Constraint)
- The coder machine is a virtual machine without physical USB pass-through to the phone.
- Do not expect a direct physical USB cable connection from the phone to coder.
- If deploying builds, use one of these two verified methods:
  1. Build the release APK on coder, transfer it to the phone or laptop, and install it.
  2. Connect `adb` over Wi-Fi on the local subnet (`adb connect <phone-ip>:5555`).

---

## 4. Test Phone and Devices (Feasible with Constraints)

### Available Phone (Ready)
- Model: Samsung Galaxy S24 Ultra (1 TB storage)
- Operating System: Android 14 with One UI 6.1+
- Mount: Secure Quad Lock vibration-dampened mount
- Connectivity: Active cellular data and Wi-Fi 6

### Unavailable Devices (Cannot Be Done)
- Samsung Galaxy S23 Ultra: Has a broken display. It cannot be used for road testing.
- Google Pixel: Not owned. Deferred per spike plan.
- Xiaomi device: Not owned. Deferred per spike plan.
- iPhone / iOS devices: Not owned. Deferred per spike plan.

---

## 5. Vehicle and Road Testing (Modified Constraint)

All agents must note this physical constraint.

### Real Transit Reality
- The owner NEVER drives a car and does not cycle for transit.
- All vehicle transit, commutes, and delivery sessions occur on a **Yamaha BWs 125 scooter**.
- The phone is mounted to the scooter handlebar via a Quad Lock mount.
- Audio and prompts connect to a Sena Outrush 2 modular Bluetooth helmet.

### Impact on Test Procedures
- CANNOT conduct 50 km continuous 100 km/h highway drive tests. A 125cc scooter cannot enter 400-series highways.
- Distance and odometer verification must use the scooter physical odometer.
- Dead-zone tests must use local urban routes and arterial roads with known cellular dead spots in Toronto.
- Battery and background tests reflect real delivery riding conditions (frequent stops, idle vibration, screen off in mount).

---

## 6. Accounts and Network Configuration

### Homelab Network Reality
- The homelab does NOT currently run a production Tailscale network.
- The homelab runs native WireGuard (`<wireguard-name>` on <wireguard-subnet> via router at <router>).
- Homelab web portals use internal domain routing (`*.lan`) through Nginx Proxy Manager with an internal Root CA.

### Tailscale for Spike D
- If Spike D strictly requires Tailscale MagicDNS and HTTPS, the human operator must create or authenticate a Tailscale account.
- The VM can join the tailnet via `tailscale up` and test `tailscale serve`.
- If Tailscale is unavailable, the fallback is to test the same secure ingest over the existing homelab WireGuard tunnel.

---

## 7. Action Plan for the Infra Agent

1. Create Proxmox VM `milewage-spike` (Debian 12, 1 vCPU, 1 GB RAM, 20 GB disk, no-cache).
2. Install Docker, Node 22.22+, and build dependencies on the VM.
3. Create the clean baseline snapshot named `os-ready`.
4. Verify that `qm stop <vmid>` hard stop works from the Proxmox host shell.
5. Coordinate with the human operator to authenticate Tailscale or activate WireGuard for Spike D.
6. Compile the release APK on the coder server and sideload it to the Galaxy S24 Ultra.
7. Conduct road tests on the Yamaha BWs 125 scooter using Quad Lock and local arterial routes.
