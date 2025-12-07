# ZFS–VMware DR Helper Script

This project provides a fully automated, interactive PowerShell workflow to manage DR operations using ZFS‐replicated NFS datastores in combination with VMware vCenter and ESXi.  
It enables **protecting VMs**, **building DR recovery shells**, and **flipping DR VMs back into production** using replicated VMDKs stored on ZFS.

---

## 🔧 Features

### ✔️ Single Credential Prompt  
The script asks for vCenter credentials **once** and reuses them for all vCenter connections.

### ✔️ Number‑Based Selection  
No need to type long vCenter object names.  
The script shows numbered menus for:

- Datacenters  
- Clusters  
- Virtual Machines  
- Datastores (NFS only)  
- Networks  

Choose by number, not text.

### ✔️ NFS/ZFS‑Aware DR Workflow  
The script assumes replication is done via **ZFS → syncoid → NFS datastore** mounted in VMware.

During DR VM creation it:

- Reads the **source VM's disk layout**
- Identifies the replicated folders on DR datastore
- Auto‑detects matching replicated folders using:
  - Exact match
  - Prefix match (e.g. `S06-NORDIC-*`)
- Prompts you to pick the correct folder when multiple options exist

This removes the historically painful need to manually track cloned or differently‑named folders.

### ✔️ DR VM Shell Creation  
- Creates a shell VM on the DR vCenter
- Matches:
  - CPU count  
  - Memory  
  - Guest OS type  
  - Firmware (if supported by your PowerCLI)
- Removes default disk
- Reuses the existing SCSI controller
- Attempts to set correct SCSI type
- Attaches replicated VMDKs correctly

### ✔️ Optional Test Boot  
After building the DR VM:

- Power on  
- Wait for VMware Tools heartbeat  
- Gracefully shut down  

Great for verifying successful DR boot.

### ✔️ Flip DR Back to PROD  
Once DR VM is updated:

- Power off PROD VM  
- Remove PROD disks  
- Attach VMDKs from DR datastore  
- Match SCSI controller type when possible  
- Prepare PROD VM for booting from DR data

This enables a **clean failback** process.

---

## 🧱 Requirements

- Windows workstation with **PowerShell** + **VMware PowerCLI**  
- Access to:
  - Source vCenter  
  - DR vCenter  
  - ZFS server exporting replicated dataset via NFS  
- Datastore must be mounted in **both** vCenters as NFS  
- Replicated folders must exist on ZFS under exported path (e.g. `/vrep/<folder>`)

---

## 📂 Files

| File | Description |
|------|-------------|
| `zerfaux.ps1` | Main script – DR automation workflow |
| `README.md` | This documentation |

---

## ▶️ Usage

### 1. Run the Script

```powershell
.\zerfaux.ps1
```

You will be prompted for vCenter credentials once.

---

## 📘 Menu Options

### **Option 1 — Protect VM on SOURCE vCenter**

- Moves VM storage to the ZFS‑backed NFS datastore  
- Prepares the VM for replication  
- Ideal for pairing with `syncoid` replication jobs

---

### **Option 2 — Build DR VM Shell on DESTINATION vCenter**

This:

1. Reads source VM attributes  
2. Selects DR vCenter, DC, Cluster, Datastore, Network  
3. Auto‑detects appropriate DR folder (e.g. `S06-NORDIC-VRP`)  
4. Attaches correct replicated VMDKs  
5. Optionally boots the VM to verify integrity  

---

### **Option 3 — Flip DR Back to PROD**

When DR has newer data:

- Power off PROD VM  
- Remove old disk attachments  
- Attach replicated disks from DR  
- Adjust SCSI controller if supported  
- Ready for controlled failback boot  

---

## 🔎 Auto‑Detection of DR Folders

The script compares the source VM name to DR datastore folders using:

- Exact match (preferred)
- Prefix match (e.g. `S06-NORDIC-*`)
- Manual override if required

Example:

- Source VM: `S06-NORDIC-GLD`
- DR folder: `S06-NORDIC-VRP`

Script output:

```
Detected DR folder matching prefix 'S06-NORDIC': 'S06-NORDIC-VRP'
Use this folder? (yes/no)
```

This **prevents VMX write errors** caused by vSphere being pointed at a folder that doesn’t exist.

---

## 🛠 Troubleshooting

### ❗ VMX Write Errors on DR VM Creation

If VMware errors like:

```
Unable to write VMX file ... could not find file
```

Then **folder names do not match** on DR datastore.

Fix:

- Let the script auto‑detect  
- Or manually specify the correct folder when prompted  

---

### ❗ Test VM Fails to Build on DR datastore

If vSphere can’t create a test VM:

- Check NFS export options on ZFS  
- Ensure RW + no_root_squash  
- Check ESXi host has write access  
- Unmount/remount the datastore if necessary  

