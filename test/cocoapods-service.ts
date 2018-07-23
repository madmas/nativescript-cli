import * as yok from "../lib/common/yok";
import { assert } from "chai";
import { CocoaPodsService } from "../lib/services/cocoapods-service";
import { EOL } from "os";

interface IMergePodfileHooksTestCase {
	input: string;
	output: string;
	testCaseDescription: string;
	projectPodfileContent?: string;
}

function createTestInjector(): IInjector {
	const testInjector: IInjector = new yok.Yok();

	testInjector.register("fs", {});
	testInjector.register("cocoapodsService", CocoaPodsService);

	return testInjector;
}

// The newline characters should be replaced with EOL because on Windows the EOL is \r\n
// but the character which is placed in `` for newline is only \n
// if we do not replace the newline characters the tests will pass only on linux and mac.
function changeNewLineCharacter(input: string): string {
	return input ? input.replace(/\r?\n/g, EOL) : input;
}

describe("Cocoapods service", () => {
	describe("merge Podfile hooks", () => {
		let testInjector: IInjector;
		let cocoapodsService: ICocoaPodsService;
		let newPodfileContent = "";

		const mockFileSystem = (injector: IInjector, podfileContent: string, projectPodfileContent?: string): void => {
			const fs: IFileSystem = injector.resolve("fs");

			fs.exists = () => true;
			fs.readText = (file: string) => {
				if (file.indexOf("pluginPlatformsFolderPath") !== -1) {
					return podfileContent;
				}

				return newPodfileContent || projectPodfileContent || "";
			};

			fs.writeFile = (pathToFile: string, content: any) => {
				console.trace("writing new podfile content: ", newPodfileContent);
				newPodfileContent = content;
			};
		};

		const testCases: IMergePodfileHooksTestCase[] = [
			{
				input: `
target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

post_install do |installer|
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end`,
				output: `use_frameworks!

target "projectName" do
# Begin Podfile - pluginPlatformsFolderPath/Podfile

target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

def post_installplugin1_0 (installer)
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
# End Podfile

post_install do |installer|
  post_installplugin1_0 installer
end
end`,
				projectPodfileContent: `use_frameworks!

target "projectName" do
# Begin Podfile - pluginPlatformsFolderPath/Podfile

target 'MyApp' do
	pod 'GoogleAnalytics', '~> 2.1' # version changed here
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

def post_installplugin1_0 (installer)
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
# End Podfile

post_install do |installer|
	post_installplugin1_0 installer
end
end`,
				testCaseDescription: "replaces the plugin's old Podfile with the new one inside project's Podfile"
			},
			{
				input: `
target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

post_install do |installer|
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
post_install do |installer|
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
post_install do |installer|
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end`,
				output: `use_frameworks!

target "projectName" do
# Begin Podfile - pluginPlatformsFolderPath/Podfile

target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

def post_installplugin1_0 (installer)
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
def post_installplugin1_1 (installer)
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
def post_installplugin1_2 (installer)
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
# End Podfile

post_install do |installer|
  post_installplugin1_0 installer
  post_installplugin1_1 installer
  post_installplugin1_2 installer
end
end`,
				testCaseDescription: "merges more than one hooks with block parameter correctly."
			}, {
				input: `
target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end

	post_install do |installer_representation|
		installer_representation.pods_project.targets.each do |target|
			puts target.name
		end
	end
	post_install do
		puts "Hello World!"
	end
end`,
				output: `use_frameworks!

target "projectName" do
# Begin Podfile - pluginPlatformsFolderPath/Podfile

target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end

	def post_installplugin1_0 (installer_representation)
		installer_representation.pods_project.targets.each do |target|
			puts target.name
		end
	end
	def post_installplugin1_1
		puts "Hello World!"
	end
end
# End Podfile

post_install do |installer|
  post_installplugin1_0 installer
  post_installplugin1_1
end
end`,
				testCaseDescription: "merges more than one hooks with and without block parameter correctly."
			}, {
				input: `
target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

post_install do |installer|
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end`,
				output: "",
				projectPodfileContent: `use_frameworks!

target "projectName" do
# Begin Podfile - pluginPlatformsFolderPath/Podfile

target 'MyApp' do
	pod 'GoogleAnalytics', '~> 3.1'
	target 'MyAppTests' do
		inherit! :search_paths
			pod 'OCMock', '~> 2.0.1'
		end
end

def post_installplugin1_0 (installer)
	installer.pods_project.targets.each do |target|
		puts target.name
	end
end
# End Podfile

post_install do |installer|
  post_installplugin1_0 installer
end
end`,
				testCaseDescription: "should not change the Podfile when the plugin content is already part of the project."
			}
		];

		beforeEach(() => {
			testInjector = createTestInjector();
			cocoapodsService = testInjector.resolve("cocoapodsService");
			newPodfileContent = "";
		});

		_.each(testCases, (testCase: IMergePodfileHooksTestCase) => {
			it(testCase.testCaseDescription, async () => {
				mockFileSystem(testInjector, testCase.input, testCase.projectPodfileContent);

				await cocoapodsService.applyPluginPodfileToProject(
					<any>{
						name: "plugin1",
						pluginPlatformsFolderPath: () => "pluginPlatformsFolderPath"
					},
					<any>{
						projectDir: "projectDir",
						projectName: "projectName"
					},
					"path"
				);

				assert.deepEqual(changeNewLineCharacter(newPodfileContent), changeNewLineCharacter(testCase.output));
			});
		});
	});
});
