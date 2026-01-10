import { IDict } from '@jupytergis/schema';

import { requestAPI } from '../tools';

/**
 * Response from SFCGAL availability check
 */
export interface ISFCGALStatus {
  available: boolean;
  operations: string[];
}

/**
 * Check if SFCGAL is available on the server
 */
export async function checkSFCGALAvailability(): Promise<ISFCGALStatus> {
  try {
    const response = await requestAPI<ISFCGALStatus>('jupytergis_core/sfcgal', {
      method: 'GET',
    });
    return response;
  } catch (error) {
    console.warn('Failed to check SFCGAL availability:', error);
    return { available: false, operations: [] };
  }
}

/**
 * Execute a SFCGAL processing operation
 *
 * @param operation - The SFCGAL operation to execute
 * @param geojson - The input GeoJSON data
 * @param params - Additional parameters for the operation
 * @returns The processed GeoJSON result
 */
export async function executeSFCGALProcessing(
  operation: string,
  geojson: any,
  params: IDict = {},
): Promise<any> {
  const response = await requestAPI<any>('jupytergis_core/sfcgal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation,
      geojson,
      params,
    }),
  });

  return response;
}
