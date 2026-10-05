export type StructuredDeclaration = {
  value: string | null;
  confidence: number;
};

export type ProductInformationState = {
  generic_name: StructuredDeclaration;
  manufacturer: StructuredDeclaration;
  net_quantity: StructuredDeclaration;
  mrp: StructuredDeclaration;
  date_of_manufacture: StructuredDeclaration;
  date_of_expiry: StructuredDeclaration;
  consumer_care: StructuredDeclaration;
  country_of_origin: StructuredDeclaration;
};

export const createEmptyState = (): ProductInformationState => ({
  generic_name: { value: null, confidence: 0 },
  manufacturer: { value: null, confidence: 0 },
  net_quantity: { value: null, confidence: 0 },
  mrp: { value: null, confidence: 0 },
  date_of_manufacture: { value: null, confidence: 0 },
  date_of_expiry: { value: null, confidence: 0 },
  consumer_care: { value: null, confidence: 0 },
  country_of_origin: { value: null, confidence: 0 },
});

export function mergeExtraction(
  currentState: ProductInformationState,
  incoming: any
): ProductInformationState {
  if (!incoming?.declarations) return currentState;
  const docs = incoming.declarations;

  const nextState = { ...currentState };
  
  for (const key of Object.keys(nextState) as (keyof ProductInformationState)[]) {
    const incField = docs[key];
    const curField = nextState[key];
    
    if (incField?.value) {
      if (!curField.value || incField.confidence > curField.confidence) {
        nextState[key] = {
          value: incField.value,
          confidence: incField.confidence || 0
        };
      }
    }
  }

  return nextState;
}

export function calculateCoverage(state: ProductInformationState): { percent: number; missing: string[]; found: string[] } {
  const fields = [
    { key: "generic_name", label: "Product Name" },
    { key: "manufacturer", label: "Manufacturer/Packer" },
    { key: "net_quantity", label: "Net Quantity" },
    { key: "mrp", label: "MRP" },
    { key: "date_of_manufacture", label: "Manufacturing Date" },
    { key: "date_of_expiry", label: "Expiry / Best Before" },
    { key: "consumer_care", label: "Consumer Care" }
  ];
  
  let count = 0;
  const missing: string[] = [];
  const found: string[] = [];

  fields.forEach(f => {
    if (state[f.key as keyof ProductInformationState].value) {
      count++;
      found.push(f.label);
    } else {
      missing.push(f.label);
    }
  });

  return {
    percent: Math.round((count / fields.length) * 100),
    missing,
    found
  };
}
