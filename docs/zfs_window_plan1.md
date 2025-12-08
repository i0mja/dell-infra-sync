# ZFS Target Wizard Redesign Plan

## Problem Statement
The current OnboardZfsTargetWizard has several UX issues:
1. **Content overflow**: Expanding collapsibles cause the dialog to overflow beyond viewport
2. **No scroll functionality**: Users can't access content that extends off-page
3. **Overloaded Step 1**: Contains too much content (VM selection, SSH auth, ZFS config, NFS, vCenter integration, advanced options, protection)
4. **Broken two-column layout**: Layout breaks when sections expand

## Solution: 6-Page Discrete Step Wizard

Convert the wizard into a proper multi-page flow where each page:
- Fits on screen without scrolling (max-h-[80vh])
- Has a clear, focused purpose
- Uses Back/Next navigation buttons
- Shows visual progress indicator

---

## Page Structure

| Page | Title | Content | Validation |
|------|-------|---------|------------|
| **1** | Select Target | vCenter dropdown, VM combobox, Target name | vCenter + VM + name required |
| **2** | SSH Authentication | Auth method, credentials, Test Connection | Auth configured |
| **3** | Storage Configuration | ZFS pool, compression, disks; NFS CIDR | Pool name required |
| **4** | vCenter Integration | Datastore name, advanced options | Datastore name required |
| **5** | Protection (Optional) | Protection group, schedule, VMs | Always valid (can skip) |
| **6** | Review & Deploy | Summary, Start Setup button | All previous valid |

---

## Page Content Details

### Page 1: Select Target (~100 lines)
- vCenter dropdown with status indicators
- VM Combobox with cluster/power filters
- VM preview card (power state, specs, IP)
- Target name input with auto-generation
- Duplicate/compatibility warnings

### Page 2: SSH Authentication (~150 lines)
- Radio group for auth method:
  - Use existing SSH key (dropdown + fingerprint)
  - Generate new SSH key (button + status)
  - Use password (password input)
- "Test SSH Connection" button with result badge
- Connection status persists across navigation

### Page 3: Storage Configuration (~120 lines)
- **ZFS Section:**
  - Pool name input
  - Compression dropdown (lz4, zstd, off)
  - Disk selection (if SSH tested) or auto-detect note
- **NFS Section:**
  - Allowed network CIDR input with validation

### Page 4: vCenter Integration (~80 lines)
- Datastore name input (defaults from target name)
- **Advanced Options:**
  - ☑ Install ZFS & NFS packages
  - ☑ Create zfsadmin user
  - ☐ Reset machine-id (for clones)

### Page 5: Protection (Optional) (~180 lines)
- Radio group: Skip / Create new / Add to existing
- If new: Group name, description
- If existing: Group dropdown
- Schedule preset buttons (15m, 1h, 4h, Daily, Custom)
- VM multi-select (max 20 shown)

### Page 6: Review & Deploy (~100 lines)
- Summary card with all configured settings
- "Start Setup" button
- Job progress display (when running)
- Step results with retry/fix buttons

---

## UI Components

### Dialog Container
```tsx
<DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
```

### Page Indicator
```tsx
const WIZARD_PAGES = [
  { id: 1, label: 'Target', icon: Server },
  { id: 2, label: 'SSH', icon: Key },
  { id: 3, label: 'Storage', icon: HardDrive },
  { id: 4, label: 'vCenter', icon: Plug },
  { id: 5, label: 'Protect', icon: Shield },
  { id: 6, label: 'Review', icon: CheckCircle2 },
];
```

### Navigation Footer
```tsx
<DialogFooter className="flex justify-between border-t pt-4 mt-4">
  <Button variant="outline" onClick={handleBack} disabled={currentPage === 1}>
    Back
  </Button>
  <div className="flex gap-2">
    <Button variant="ghost" onClick={() => onOpenChange(false)}>
      Cancel
    </Button>
    {currentPage < 6 ? (
      <Button onClick={handleNext} disabled={!canProceed}>
        Next
      </Button>
    ) : (
      <Button onClick={handleStartSetup}>
        Start Setup
      </Button>
    )}
  </div>
</DialogFooter>
```

---

## State Management

### Page Navigation
```tsx
const [currentPage, setCurrentPage] = useState(1);

const handleNext = () => setCurrentPage(p => Math.min(p + 1, 6));
const handleBack = () => setCurrentPage(p => Math.max(p - 1, 1));
```

### Page Validation
```tsx
const canProceedFromPage = (page: number): boolean => {
  switch (page) {
    case 1: return !!selectedVCenterId && !!selectedVMId && !!targetName;
    case 2: return authMethod === 'password' ? !!rootPassword : 
            authMethod === 'existing_key' ? !!selectedSshKeyId : true;
    case 3: return !!zfsPoolName;
    case 4: return true; // Datastore defaults from target name
    case 5: return true; // Optional
    case 6: return !isJobRunning;
    default: return false;
  }
};
```

---

## Implementation Checklist

- [ ] Update WIZARD_PAGES constant with 6 pages
- [ ] Replace currentStep with currentPage state
- [ ] Create 6 separate page render sections
- [ ] Remove Collapsible components from main content
- [ ] Add Back/Next navigation footer
- [ ] Implement page validation logic
- [ ] Ensure all state persists across page navigation
- [ ] Move job execution to Page 6 only
- [ ] Test each page fits within viewport

---

## Expected Outcomes

- **Lines removed:** ~200 (collapsibles, duplicate code)
- **Lines added:** ~100 (navigation, page separation)
- **Net change:** ~100 line reduction
- **UX improvement:** Dramatic - clear progression, no overflow
