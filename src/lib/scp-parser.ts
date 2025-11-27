/**
 * SCP File Parser and Validator
 * Handles JSON and XML SCP files from Dell iDRAC
 */

export interface ScpComponent {
  fqdd: string;
  attributes: Array<{
    name: string;
    value: any;
  }>;
}

export interface ScpParseResult {
  valid: boolean;
  error?: string;
  content?: any;
  components?: ScpComponent[];
  metadata?: {
    model?: string;
    serviceTag?: string;
    timestamp?: string;
  };
  detectedComponents: {
    hasBios: boolean;
    hasIdrac: boolean;
    hasNic: boolean;
    hasRaid: boolean;
    biosCount: number;
    idracCount: number;
    nicCount: number;
    raidCount: number;
  };
}

const FQDD_PATTERNS = {
  BIOS: /^BIOS\./i,
  IDRAC: /^iDRAC\.|^IDRAC\./i,
  NIC: /^NIC\.|^FC\.|^InfiniBand\./i,
  RAID: /^RAID\.|^Disk\.|^Enclosure\./i,
};

/**
 * Parse XML SCP file to JSON structure
 */
function parseXmlScp(xmlContent: string): any {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
    
    // Check for parse errors
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      throw new Error("Invalid XML format");
    }

    const systemConfig = xmlDoc.querySelector("SystemConfiguration");
    if (!systemConfig) {
      throw new Error("Missing SystemConfiguration element");
    }

    const result: any = {
      SystemConfiguration: {
        Model: systemConfig.getAttribute("Model") || undefined,
        ServiceTag: systemConfig.getAttribute("ServiceTag") || undefined,
        TimeStamp: systemConfig.getAttribute("TimeStamp") || undefined,
        Components: []
      }
    };

    // Extract components
    const components = xmlDoc.querySelectorAll("Component");
    components.forEach(component => {
      const fqdd = component.getAttribute("FQDD");
      if (!fqdd) return;

      const attributes: Array<{ Name: string; Value: string }> = [];
      const attributeElements = component.querySelectorAll("Attribute");
      
      attributeElements.forEach(attr => {
        const name = attr.getAttribute("Name");
        const value = attr.textContent;
        if (name) {
          attributes.push({ Name: name, Value: value || "" });
        }
      });

      result.SystemConfiguration.Components.push({
        FQDD: fqdd,
        Attributes: attributes
      });
    });

    return result;
  } catch (error) {
    throw new Error(`XML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Detect which components are present in the SCP content
 */
function detectComponents(content: any): ScpParseResult["detectedComponents"] {
  const result = {
    hasBios: false,
    hasIdrac: false,
    hasNic: false,
    hasRaid: false,
    biosCount: 0,
    idracCount: 0,
    nicCount: 0,
    raidCount: 0,
  };

  const components = content?.SystemConfiguration?.Components || content?.Components || [];
  
  components.forEach((component: any) => {
    const fqdd = component.FQDD || component.fqdd || "";
    const attrCount = component.Attributes?.length || component.attributes?.length || 0;

    if (FQDD_PATTERNS.BIOS.test(fqdd)) {
      result.hasBios = true;
      result.biosCount += attrCount;
    } else if (FQDD_PATTERNS.IDRAC.test(fqdd)) {
      result.hasIdrac = true;
      result.idracCount += attrCount;
    } else if (FQDD_PATTERNS.NIC.test(fqdd)) {
      result.hasNic = true;
      result.nicCount += attrCount;
    } else if (FQDD_PATTERNS.RAID.test(fqdd)) {
      result.hasRaid = true;
      result.raidCount += attrCount;
    }
  });

  return result;
}

/**
 * Validate that content is an SCP file and not a task response
 */
function validateScpStructure(content: any): { valid: boolean; error?: string } {
  // Reject task status responses
  if (content["@odata.type"] || content.TaskState || content.TaskStatus) {
    return {
      valid: false,
      error: "This appears to be a task status response, not an SCP configuration file"
    };
  }

  // Check for valid SCP structure
  const hasSystemConfig = content.SystemConfiguration;
  const hasComponents = content.Components || content.SystemConfiguration?.Components;

  if (!hasSystemConfig && !hasComponents) {
    return {
      valid: false,
      error: "Invalid SCP file structure. Missing SystemConfiguration or Components section"
    };
  }

  const components = hasComponents || [];
  if (!Array.isArray(components) || components.length === 0) {
    return {
      valid: false,
      error: "No configuration components found in file"
    };
  }

  return { valid: true };
}

/**
 * Extract metadata from SCP content
 */
function extractMetadata(content: any): ScpParseResult["metadata"] {
  const sysConfig = content.SystemConfiguration || content;
  
  return {
    model: sysConfig.Model || sysConfig.model || undefined,
    serviceTag: sysConfig.ServiceTag || sysConfig.serviceTag || sysConfig.service_tag || undefined,
    timestamp: sysConfig.TimeStamp || sysConfig.timestamp || sysConfig.created_at || undefined,
  };
}

/**
 * Calculate SHA-256 checksum of content
 */
export async function calculateChecksum(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Main parser function
 */
export async function parseScpFile(content: string, filename: string): Promise<ScpParseResult> {
  try {
    let parsed: any;
    const isXml = content.trim().startsWith('<?xml') || content.trim().startsWith('<');

    // Parse based on format
    if (isXml) {
      parsed = parseXmlScp(content);
    } else {
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        return {
          valid: false,
          error: "Invalid JSON format",
          detectedComponents: {
            hasBios: false,
            hasIdrac: false,
            hasNic: false,
            hasRaid: false,
            biosCount: 0,
            idracCount: 0,
            nicCount: 0,
            raidCount: 0,
          }
        };
      }
    }

    // Validate structure
    const validation = validateScpStructure(parsed);
    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error,
        detectedComponents: {
          hasBios: false,
          hasIdrac: false,
          hasNic: false,
          hasRaid: false,
          biosCount: 0,
          idracCount: 0,
          nicCount: 0,
          raidCount: 0,
        }
      };
    }

    // Extract components and metadata
    const components = parsed.SystemConfiguration?.Components || parsed.Components || [];
    const metadata = extractMetadata(parsed);
    const detectedComponents = detectComponents(parsed);

    return {
      valid: true,
      content: parsed,
      components,
      metadata,
      detectedComponents,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Failed to parse file",
      detectedComponents: {
        hasBios: false,
        hasIdrac: false,
        hasNic: false,
        hasRaid: false,
        biosCount: 0,
        idracCount: 0,
        nicCount: 0,
        raidCount: 0,
      }
    };
  }
}
