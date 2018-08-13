import { AndroidDeviceLiveSyncServiceBase } from "./android-device-livesync-service-base";
import { APP_FOLDER_NAME } from "../../constants";
import { LiveSyncPaths } from "../../common/constants";
import { AndroidLivesyncTool } from "./android-livesync-tool";
import * as path from "path";
import * as temp from "temp";

export class AndroidDeviceSocketsLiveSyncService extends AndroidDeviceLiveSyncServiceBase implements IAndroidNativeScriptDeviceLiveSyncService, INativeScriptDeviceLiveSyncService {
	private livesyncTool: IAndroidLivesyncTool;
	private static STATUS_UPDATE_INTERVAL = 10000;

	constructor(
		private data: IProjectData,
		$injector: IInjector,
		protected $platformsData: IPlatformsData,
		protected $staticConfig: Config.IStaticConfig,
		$logger: ILogger,
		protected device: Mobile.IAndroidDevice,
		private $processService: IProcessService,
		private $fs: IFileSystem,
		$filesHashService: IFilesHashService) {
			super($injector, $platformsData, $filesHashService, $logger, device);
			this.livesyncTool = this.$injector.resolve(AndroidLivesyncTool);
	}

	public async beforeLiveSyncAction(deviceAppData: Mobile.IDeviceAppData): Promise<void> {
		const platformData = this.$platformsData.getPlatformData(deviceAppData.platform, this.data);
		const projectFilesPath = path.join(platformData.appDestinationDirectoryPath, APP_FOLDER_NAME);
		const pathToLiveSyncFile = temp.path({ prefix: "livesync" });
		this.$fs.writeFile(pathToLiveSyncFile, "");
		await this.device.fileSystem.putFile(pathToLiveSyncFile, this.getPathToLiveSyncFileOnDevice(deviceAppData.appIdentifier), deviceAppData.appIdentifier);
		await this.device.applicationManager.startApplication({ appId: deviceAppData.appIdentifier, projectName: this.data.projectName, justLaunch: true });
		await this.connectLivesyncTool(projectFilesPath, this.data.projectId);
	}

	private getPathToLiveSyncFileOnDevice(appIdentifier: string): string {
		return `${LiveSyncPaths.ANDROID_TMP_DIR_NAME}/${appIdentifier}-livesync-in-progress`;
	}

	public async finalizeSync(liveSyncInfo: ILiveSyncResultInfo, projectData: IProjectData): Promise<IAndroidLivesyncSyncOperationResult> {
		try {
			const result = await this.doSync(liveSyncInfo, projectData);
			return result;
		} finally {
			this.livesyncTool.end();
		}
	}

	private async doSync(liveSyncInfo: ILiveSyncResultInfo, projectData: IProjectData): Promise<IAndroidLivesyncSyncOperationResult> {
		const operationId = this.livesyncTool.generateOperationIdentifier();

		let result = { operationId, didRefresh: true };

		if (liveSyncInfo.modifiedFilesData.length) {
			const canExecuteFastSync = !liveSyncInfo.isFullSync && this.canExecuteFastSyncForPaths(liveSyncInfo.modifiedFilesData, projectData, this.device.deviceInfo.platform);
			const doSyncPromise = this.livesyncTool.sendDoSyncOperation(canExecuteFastSync, null, operationId);

			const syncInterval: NodeJS.Timer = setInterval(() => {
				if (this.livesyncTool.isOperationInProgress(operationId)) {
					this.$logger.info("Sync operation in progress...");
				}
			}, AndroidDeviceSocketsLiveSyncService.STATUS_UPDATE_INTERVAL);

			const actionOnEnd = async () => {
				clearInterval(syncInterval);
				await this.device.fileSystem.deleteFile(this.getPathToLiveSyncFileOnDevice(liveSyncInfo.deviceAppData.appIdentifier), liveSyncInfo.deviceAppData.appIdentifier);
			};

			this.$processService.attachToProcessExitSignals(this, actionOnEnd);
			// We need to clear resources when the action fails
			// But we also need the real result of the action.
			await doSyncPromise.then(actionOnEnd.bind(this), actionOnEnd.bind(this));

			result = await doSyncPromise;
		} else {
			await this.device.fileSystem.deleteFile(this.getPathToLiveSyncFileOnDevice(liveSyncInfo.deviceAppData.appIdentifier), liveSyncInfo.deviceAppData.appIdentifier);
		}

		return result;
	}

	public async refreshApplication(projectData: IProjectData, liveSyncInfo: IAndroidLiveSyncResultInfo) {
		const canExecuteFastSync = !liveSyncInfo.isFullSync && this.canExecuteFastSyncForPaths(liveSyncInfo.modifiedFilesData, projectData, this.device.deviceInfo.platform);
		if (!canExecuteFastSync || !liveSyncInfo.didRefresh) {
			await this.device.applicationManager.restartApplication({ appId: liveSyncInfo.deviceAppData.appIdentifier, projectName: projectData.projectName });
		}
	}

	public async removeFiles(deviceAppData: Mobile.IDeviceAppData, localToDevicePaths: Mobile.ILocalToDevicePathData[], projectFilesPath: string): Promise<void> {
		await this.livesyncTool.removeFiles(_.map(localToDevicePaths, (element: any) => element.filePath));
		const deviceHashService = this.getDeviceHashService(deviceAppData.appIdentifier);
		await deviceHashService.removeHashes(localToDevicePaths);
	}

	public async transferFilesOnDevice(deviceAppData: Mobile.IDeviceAppData, localToDevicePaths: Mobile.ILocalToDevicePathData[]): Promise<void> {
		const files = _.map(localToDevicePaths, localToDevicePath => localToDevicePath.getLocalPath());
		await this.livesyncTool.sendFiles(files);
	}

	public async transferDirectoryOnDevice(deviceAppData: Mobile.IDeviceAppData, localToDevicePaths: Mobile.ILocalToDevicePathData[], projectFilesPath: string): Promise<void> {
		await this.livesyncTool.sendDirectory(projectFilesPath);
	}

	private async connectLivesyncTool(projectFilesPath: string, appIdentifier: string) {
		await this.livesyncTool.connect({
			appIdentifier,
			deviceIdentifier: this.device.deviceInfo.identifier,
			appPlatformsPath: projectFilesPath
		});
	}
}
