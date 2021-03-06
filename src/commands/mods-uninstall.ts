import * as _ from "lodash";
import * as clc from "cli-color";
import * as ora from "ora";
import * as Command from "../command";
import { FirebaseError } from "../error";
import * as getProjectId from "../getProjectId";
import { iam } from "../gcp";
import * as modsApi from "../mods/modsApi";
import { ensureModsApiEnabled, logPrefix } from "../mods/modsHelper";
import { promptOnce } from "../prompt";
import * as requirePermissions from "../requirePermissions";
import * as utils from "../utils";

export default new Command("mods:uninstall <modInstanceId>")
  .description("uninstall a mod that is installed in your Firebase project by instance ID")
  .option("-f, --force", "No confirmation. Otherwise, a confirmation prompt will appear.")
  .before(requirePermissions, [
    // TODO: This doesn't exist yet. Uncomment when it does.
    // "firebasemods.instances.delete"
  ])
  .before(ensureModsApiEnabled)
  .action(async (instanceId: string, options: any) => {
    const projectId = getProjectId(options);
    let instance;
    try {
      instance = await modsApi.getInstance(projectId, instanceId);
    } catch (err) {
      if (err.status === 404) {
        return utils.reject(`No mod instance ${instanceId} in project ${projectId}.`, {
          exit: 1,
        });
      }
      throw err;
    }
    let confirmedServiceAccountDeletion;
    if (!options.force) {
      const resourcesMessage = _.get(instance, "configuration.source.spec.resources", []).length
        ? "This will delete the following resources \n" +
          instance.configuration.source.spec.resources
            .map((resource: modsApi.Resource) => `- ${resource.type}: ${resource.name} \n`)
            .join("")
        : "";
      const modDeletionMessage = `You are about to uninstall mod ${clc.bold(
        instanceId
      )} from project ${clc.bold(projectId)}.\n${resourcesMessage}Are you sure?`;
      const confirmedModDeletion = await promptOnce({
        type: "confirm",
        default: true,
        message: modDeletionMessage,
      });
      if (!confirmedModDeletion) {
        return utils.reject("Command aborted.", { exit: 1 });
      }

      const rolesMessage = _.get(instance, "configuration.source.spec.roles", []).length
        ? " which had the following authorized roles in your project:\n" +
          instance.configuration.source.spec.roles
            .map((role: modsApi.Role) => `- ${role.role} \n`)
            .join("")
        : ". \n";
      const serviceAccountDeletionMessage = `This mod used service account ${clc.bold(
        instance.serviceAccountEmail
      )} ${rolesMessage}Do you want to delete this service account?`;
      confirmedServiceAccountDeletion = await promptOnce({
        type: "confirm",
        default: false,
        message: serviceAccountDeletionMessage,
      });
    }

    const spinner = ora.default(
      `Uninstalling ${clc.bold(instanceId)}. This usually takes 1 to 2 minutes...`
    );
    spinner.start();
    try {
      await modsApi.deleteInstance(projectId, instanceId);
      if (confirmedServiceAccountDeletion || options.force) {
        await iam.deleteServiceAccount(projectId, instance.serviceAccountEmail);
        utils.logLabeledBullet(
          logPrefix,
          `deleted service account ${clc.bold(instance.serviceAccountEmail)}`
        );
      }
      spinner.stop();
    } catch (err) {
      spinner.fail();
      if (err instanceof FirebaseError) {
        throw err;
      }
      return utils.reject(`Error occurred uninstalling mod ${instanceId}`, { original: err });
    }
    utils.logLabeledSuccess(logPrefix, `uninstalled ${instanceId}`);
  });
