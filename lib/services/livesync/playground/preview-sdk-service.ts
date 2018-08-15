import { FilePayload, MessagingService, Config, Device, DeviceConnectedMessage, SdkCallbacks, ConnectedDevices } from "nativescript-preview-sdk";
import { EventEmitter } from "events";
import { PreviewSdkEventNames, PubnubKeys } from "./preview-app-constants";

export class PreviewSdkService extends EventEmitter implements IPreviewSdkService {
	private messagingService: MessagingService = null;
	private instanceId: string = null;
	public connectedDevices: DeviceConnectedMessage[] = [];

	constructor(private $errors: IErrors,
		private $logger: ILogger) {
		super();
	}

	public initialize(): void {
		const initConfig = this.getInitConfig();
		this.messagingService = new MessagingService();
		this.instanceId = this.messagingService.initialize(initConfig);
	}

	public applyChanges(files: FilePayload[]): Promise<void> {
		return new Promise((resolve, reject) => {
			this.messagingService.applyChanges(this.instanceId, files, err => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	public stop(): void {
		this.messagingService.stop();
	}

	private getInitConfig(): Config {
		return {
			pubnubPublishKey: PubnubKeys.PUBLISH_KEY,
			pubnubSubscribeKey: PubnubKeys.SUBSCRIBE_KEY,
			callbacks: this.getCallbacks(),
			getInitialFiles: async () => [],
			instanceId: "qhOOo1lqK"
		};
	}

	private getCallbacks(): SdkCallbacks {
		return {
			onLogSdkMessage: (log: string) => {
				this.$logger.trace("onLogSdkMessage!!!", log);
			},
			onConnectedDevicesChange: (connectedDevices: ConnectedDevices) => ({ }),
			onLogMessage: (log: string, deviceName: string) => {
				this.$logger.trace(`device name: ${deviceName} log: ${log}`);
			},
			onRestartMessage: () => {
				console.log("ON RESTART MESSAGE!!!");
			},
			onUncaughtErrorMessage: () => {
				this.$errors.failWithoutHelp("UncaughtErrorMessage while preview app!!");
			},
			onDeviceConnected: (deviceConnectedMessage: DeviceConnectedMessage) => {
				this.emit(PreviewSdkEventNames.DEVICE_CONNECTED, deviceConnectedMessage);
				this.connectedDevices.push(deviceConnectedMessage);
			},
			onDevicesPresence: (devices: Device[]) => {
				this.connectedDevices.forEach(connectedDevice => {
					const device = _.find(devices, d => d.id === connectedDevice.deviceId);
					if (!device) {
						_.remove(this.connectedDevices, d => d.deviceId === connectedDevice.deviceId);
					}
				});
			},
			onSendingChange: (sending: boolean) => ({ })
		};
	}
}
$injector.register("previewSdkService", PreviewSdkService);