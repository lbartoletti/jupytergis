import {
  IDict,
  IJGISFormSchemaRegistry,
  IJGISLayer,
  IJGISSource,
  ProcessingMerge,
  ProcessingLogicType,
  ProcessingType,
} from '@jupytergis/schema';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { CommandRegistry } from '@lumino/commands';
import { UUID } from '@lumino/coreutils';

import {
  selectedLayerIsOfType,
  processSelectedLayer,
  getSingleSelectedLayer,
  getLayerGeoJSON,
} from './index';
import { processingFormToParam } from './processingFormToParam';
import {
  executeSFCGALProcessing,
  checkSFCGALAvailability,
} from './sfcgalProcessing';
import { ProcessingFormDialog } from '../dialogs/ProcessingFormDialog';
import { JupyterGISTracker } from '../types';

export function replaceInSql(
  sql: string,
  keyToVal: IDict<string>,
  layerName: string,
) {
  const replaceTemplateString = (args: {
    variableName: string;
    template: string;
    value: string;
  }): string =>
    args.template.replace(RegExp(`{${args.variableName}}`, 'g'), args.value);

  let out = replaceTemplateString({
    variableName: 'layerName',
    template: sql,
    value: layerName,
  });

  for (const [key, value] of Object.entries(keyToVal)) {
    out = replaceTemplateString({
      variableName: key,
      template: out,
      value: value,
    });
  }

  return out;
}

export function addProcessingCommands(
  app: JupyterFrontEnd,
  commands: CommandRegistry,
  tracker: JupyterGISTracker,
  trans: any,
  formSchemaRegistry: IJGISFormSchemaRegistry,
) {
  for (const processingElement of ProcessingMerge) {
    if (processingElement.type === ProcessingLogicType.vector) {
      commands.addCommand(processingElement.name, {
        label: trans.__(processingElement.label),
        isEnabled: () => selectedLayerIsOfType(['VectorLayer'], tracker),
        execute: async () => {
          await processSelectedLayer(
            tracker,
            formSchemaRegistry,
            processingElement.description as ProcessingType,
            {
              sqlQueryFn: (layerName, keyToVal) =>
                replaceInSql(
                  processingElement.operations.sql,
                  keyToVal,
                  layerName,
                ),
              gdalFunction: processingElement.operations.gdalFunction,
              options: (sqlQuery: string) => [
                '-f',
                'GeoJSON',
                '-dialect',
                'SQLITE',
                '-sql',
                sqlQuery,
                'output.geojson',
              ],
            },
            app,
          );
        },
      });
    } else if (processingElement.type === ProcessingLogicType.sfcgal) {
      // SFCGAL-based processing (server-side)
      commands.addCommand(processingElement.name, {
        label: trans.__(processingElement.label),
        isEnabled: () => selectedLayerIsOfType(['VectorLayer'], tracker),
        execute: async () => {
          await processSFCGALOperation(
            tracker,
            formSchemaRegistry,
            processingElement.description as ProcessingType,
            processingElement.operations.function,
            app,
          );
        },
      });
    } else {
      console.error('Unsupported process type:', processingElement.type);
    }
  }
}

/**
 * Process a layer using SFCGAL server-side operations
 */
async function processSFCGALOperation(
  tracker: JupyterGISTracker,
  formSchemaRegistry: IJGISFormSchemaRegistry,
  processingType: ProcessingType,
  sfcgalFunction: string,
  app: JupyterFrontEnd,
) {
  // Check SFCGAL availability
  const sfcgalStatus = await checkSFCGALAvailability();
  if (!sfcgalStatus.available) {
    showErrorMessage(
      'SFCGAL Not Available',
      'SFCGAL is not installed on the server. Please install PySFCGAL to use this feature.',
    );
    return;
  }

  const selected = getSingleSelectedLayer(tracker);
  if (!selected || !tracker.currentWidget) {
    return;
  }

  const model = tracker.currentWidget.model;
  const sources = model?.sharedModel.sources ?? {};

  const geojsonString = await getLayerGeoJSON(selected, sources, model);
  if (!geojsonString) {
    return;
  }

  const schema = {
    ...(formSchemaRegistry.getSchemas().get(processingType) as IDict),
  };
  const selectedLayerId = Object.keys(
    model?.sharedModel.awareness.getLocalState()?.selected?.value || {},
  )[0];

  // Open ProcessingFormDialog
  const formValues = await new Promise<IDict>(resolve => {
    const dialog = new ProcessingFormDialog({
      title: processingType.charAt(0).toUpperCase() + processingType.slice(1),
      schema,
      model,
      sourceData: {
        inputLayer: selectedLayerId,
        outputLayerName: selected.name,
      },
      formContext: 'create',
      processingType,
      syncData: (props: IDict) => {
        resolve(props);
        dialog.dispose();
      },
    });
    dialog.launch();
  });

  if (!formValues) {
    return;
  }

  // Extract parameters for the SFCGAL operation
  const processParams = processingFormToParam(formValues, processingType) || {};

  try {
    // Parse the input GeoJSON
    const geojson = JSON.parse(geojsonString);

    // Execute SFCGAL processing on the server
    const result = await executeSFCGALProcessing(
      sfcgalFunction,
      geojson,
      processParams,
    );

    // Add result as new layer
    const layerName = `${formValues.outputLayerName} ${processingType.charAt(0).toUpperCase() + processingType.slice(1)}`;
    const embedOutputLayer = formValues.embedOutputLayer;

    if (!embedOutputLayer) {
      // Save the output as a file
      const jgisFilePath = tracker.currentWidget?.model.filePath;
      const jgisDir = jgisFilePath
        ? jgisFilePath.substring(0, jgisFilePath.lastIndexOf('/'))
        : '';

      const outputFileName = `${formValues.outputLayerName}_${processingType}.json`;
      const savePath = jgisDir
        ? `${jgisDir}/${outputFileName}`
        : outputFileName;

      await app.serviceManager.contents.save(savePath, {
        type: 'file',
        format: 'text',
        content: JSON.stringify(result),
      });

      const newSourceId = UUID.uuid4();
      const sourceModel: IJGISSource = {
        type: 'GeoJSONSource',
        name: outputFileName,
        parameters: {
          path: outputFileName,
        },
      };

      const layerModel: IJGISLayer = {
        type: 'VectorLayer',
        parameters: { source: newSourceId },
        visible: true,
        name: layerName,
      };

      model.sharedModel.addSource(newSourceId, sourceModel);
      model.addLayer(UUID.uuid4(), layerModel);
    } else {
      // Embed the output directly into the model
      const newSourceId = UUID.uuid4();

      const sourceModel: IJGISSource = {
        type: 'GeoJSONSource',
        name: `${layerName} Source`,
        parameters: { data: result },
      };

      const layerModel: IJGISLayer = {
        type: 'VectorLayer',
        parameters: { source: newSourceId },
        visible: true,
        name: layerName,
      };

      model.sharedModel.addSource(newSourceId, sourceModel);
      model.addLayer(UUID.uuid4(), layerModel);
    }
  } catch (error: any) {
    console.error('SFCGAL processing failed:', error);
    showErrorMessage(
      'Processing Failed',
      error.message || 'An error occurred during SFCGAL processing.',
    );
  }
}
