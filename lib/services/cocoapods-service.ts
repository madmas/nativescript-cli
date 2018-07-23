import { EOL } from "os";
import * as path from "path";
import { PluginNativeDirNames, PODFILE_NAME } from "../constants";

export class CocoaPodsService implements ICocoaPodsService {
	private static PODFILE_POST_INSTALL_SECTION_NAME = "post_install";

	constructor(private $fs: IFileSystem) { }

	public getPodfileHeader(targetName: string): string {
		return `use_frameworks!${EOL}${EOL}target "${targetName}" do${EOL}`;
	}

	public getPodfileFooter(): string {
		return `${EOL}end`;
	}

	public getProjectPodfilePath(projectRoot: string): string {
		return path.join(projectRoot, PODFILE_NAME);
	}

	public async applyPluginPodfileToProject(pluginData: IPluginData, projectData: IProjectData, nativeProjectPath: string): Promise<void> {
		const pluginPodFilePath = this.getPathToPluginPodfile(pluginData);
		if (!this.$fs.exists(pluginPodFilePath)) {
			return;
		}

		const { pluginPodFileContent, replacedFunctions } = this.buildPodfileContent(pluginPodFilePath, pluginData.name);
		const pathToProjectPodfile = this.getProjectPodfilePath(nativeProjectPath);
		const projectPodfileContent = this.$fs.exists(pathToProjectPodfile) ? this.$fs.readText(pathToProjectPodfile) : "";
		let finalPodfileContent = "";
		let shouldSaveProjectPodfile = false;

		if (projectPodfileContent.indexOf(pluginPodFileContent) === -1) {
			shouldSaveProjectPodfile = true;
			// Remove old occurences of the plugin from the project's Podfile.
			this.removePluginPodfileFromProject(pluginData, projectData, nativeProjectPath);
			// Read again the Podfile content as the removeCocoapods method may have overwritten it.
			finalPodfileContent = this.$fs.exists(pathToProjectPodfile) ? this.getPodfileContentWithoutTarget(projectData, this.$fs.readText(pathToProjectPodfile)) : "";

			if (pluginPodFileContent.indexOf(CocoaPodsService.PODFILE_POST_INSTALL_SECTION_NAME) !== -1) {
				finalPodfileContent = this.addPostInstallHook(replacedFunctions, finalPodfileContent, pluginPodFileContent);
			}

			finalPodfileContent = `${pluginPodFileContent}${EOL}${finalPodfileContent}`;
		}

		if (shouldSaveProjectPodfile) {
			this.saveProjectPodfile(projectData, finalPodfileContent, nativeProjectPath);
		}
	}

	public removePluginPodfileFromProject(pluginData: IPluginData, projectData: IProjectData, projectRoot: string): void {
		const pluginPodFilePath = this.getPathToPluginPodfile(pluginData);

		if (this.$fs.exists(pluginPodFilePath) && this.$fs.exists(this.getProjectPodfilePath(projectRoot))) {
			let projectPodFileContent = this.$fs.readText(this.getProjectPodfilePath(projectRoot));
			// Remove the data between #Begin Podfile and #EndPodfile
			const regExpToRemove = new RegExp(`${this.getPluginPodfileHeader(pluginPodFilePath)}[\\s\\S]*?${this.getPluginPodfileEnd()}`, "mg");
			projectPodFileContent = projectPodFileContent.replace(regExpToRemove, "");
			projectPodFileContent = this.removePostInstallHook(pluginData, projectPodFileContent);

			if (projectPodFileContent.trim() === `use_frameworks!${EOL}${EOL}target "${projectData.projectName}" do${EOL}end`) {
				this.$fs.deleteFile(this.getProjectPodfilePath(projectRoot));
			} else {
				this.$fs.writeFile(this.getProjectPodfilePath(projectRoot), projectPodFileContent);
			}
		}
	}

	private getPathToPluginPodfile(pluginData: IPluginData): string {
		const pluginPlatformsFolderPath = pluginData.pluginPlatformsFolderPath(PluginNativeDirNames.iOS);
		const pluginPodFilePath = path.join(pluginPlatformsFolderPath, PODFILE_NAME);
		return pluginPodFilePath;
	}

	private addPostInstallHook(replacedFunctions: IRubyFunction[], finalPodfileContent: string, pluginPodFileContent: string): string {
		const hookStart = `${CocoaPodsService.PODFILE_POST_INSTALL_SECTION_NAME} do`;
		const blokParameterName = "installer";
		const postInstallHookStart = `${hookStart} |${blokParameterName}|${EOL}`;
		let postInstallHookContent = "";
		_.each(replacedFunctions, rubyFunction => {
			let functionExecution = rubyFunction.functionName;
			if (rubyFunction.functionParameters && rubyFunction.functionParameters.length) {
				functionExecution = `${functionExecution} ${blokParameterName}`;
			}

			postInstallHookContent += `  ${functionExecution}${EOL}`;
		});

		if (postInstallHookContent) {
			const index = finalPodfileContent.indexOf(postInstallHookStart);
			if (index !== -1) {
				finalPodfileContent = finalPodfileContent.replace(postInstallHookStart, `${postInstallHookStart}${postInstallHookContent}`);
			} else {
				const postInstallHook = `${postInstallHookStart}${postInstallHookContent}end`;
				finalPodfileContent = `${finalPodfileContent}${postInstallHook}`;
			}
		}

		return finalPodfileContent;
	}

	private getPodfileContentWithoutTarget(projectData: IProjectData, projectPodfileContent: string): string {
		const podFileHeader = this.getPodfileHeader(projectData.projectName);

		if (_.startsWith(projectPodfileContent, podFileHeader)) {
			projectPodfileContent = projectPodfileContent.substr(podFileHeader.length);

			const podFileFooter = this.getPodfileFooter();
			// Only remove the final end in case the file starts with the podFileHeader
			if (_.endsWith(projectPodfileContent, podFileFooter)) {
				projectPodfileContent = projectPodfileContent.substr(0, projectPodfileContent.length - podFileFooter.length);
			}
		}

		return projectPodfileContent.trim();
	}

	private saveProjectPodfile(projectData: IProjectData, projectPodfileContent: string, projectRoot: string): void {
		projectPodfileContent = this.getPodfileContentWithoutTarget(projectData, projectPodfileContent);
		const podFileHeader = this.getPodfileHeader(projectData.projectName);
		const podFileFooter = this.getPodfileFooter();
		const contentToWrite = `${podFileHeader}${projectPodfileContent}${podFileFooter}`;
		const projectPodfilePath = this.getProjectPodfilePath(projectRoot);
		this.$fs.writeFile(projectPodfilePath, contentToWrite);
	}

	private removePostInstallHook(pluginData: IPluginData, projectPodFileContent: string): string {
		const regExp = new RegExp(`^.*?${this.getHookBasicFuncNameForPlugin(CocoaPodsService.PODFILE_POST_INSTALL_SECTION_NAME, pluginData.name)}.*?$\\r?\\n`, "gm");
		projectPodFileContent = projectPodFileContent.replace(regExp, "");
		return projectPodFileContent;
	}

	private getHookBasicFuncNameForPlugin(hookName: string, pluginName: string): string {
		return `${hookName}${pluginName.replace(/[^A-Za-z0-9]/g, "")}`;
	}

	private replaceHookContent(hookName: string, podfileContent: string, pluginName: string): { replacedContent: string, newFunctions: IRubyFunction[] } {
		const hookStart = `${hookName} do`;

		const hookDefinitionRegExp = new RegExp(`${hookStart} *(\\|(\\w+)\\|)?`, "g");
		const newFunctions: IRubyFunction[] = [];

		const replacedContent = podfileContent.replace(hookDefinitionRegExp, (substring: string, firstGroup: string, secondGroup: string, index: number): string => {
			const newFunctionName = `${this.getHookBasicFuncNameForPlugin(hookName, pluginName)}_${newFunctions.length}`;
			let newDefinition = `def ${newFunctionName}`;

			const rubyFunction: IRubyFunction = { functionName: newFunctionName };
			// firstGroup is the block parameter, secondGroup is the block parameter name.
			if (firstGroup && secondGroup) {
				newDefinition = `${newDefinition} (${secondGroup})`;
				rubyFunction.functionParameters = secondGroup;
			}

			newFunctions.push(rubyFunction);
			return newDefinition;
		});

		return { replacedContent, newFunctions };
	}

	private getPluginPodfileHeader(pluginPodFilePath: string): string {
		return `# Begin Podfile - ${pluginPodFilePath}`;
	}

	private getPluginPodfileEnd(): string {
		return `# End Podfile${EOL}`;
	}

	private buildPodfileContent(pluginPodFilePath: string, pluginName: string): { pluginPodFileContent: string, replacedFunctions: IRubyFunction[] } {
		const pluginPodFileContent = this.$fs.readText(pluginPodFilePath);
		const { replacedContent, newFunctions: replacedFunctions } = this.replaceHookContent(CocoaPodsService.PODFILE_POST_INSTALL_SECTION_NAME, pluginPodFileContent, pluginName);

		return {
			pluginPodFileContent: `${this.getPluginPodfileHeader(pluginPodFilePath)}${EOL}${replacedContent}${EOL}${this.getPluginPodfileEnd()}`,
			replacedFunctions
		};
	}

}

$injector.register("cocoapodsService", CocoaPodsService);
