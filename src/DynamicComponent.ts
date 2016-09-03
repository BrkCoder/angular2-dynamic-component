import {
	Component,
	Input,
	Compiler,
	ComponentMetadataType,
	ElementRef,
	OnChanges,
	NgModule,
	ViewContainerRef,
	ComponentRef,
	ModuleWithComponentFactories
} from '@angular/core';

import {CommonModule} from "@angular/common";

import {
	isPresent,
	isBlank,
	isArray,
	isString
} from '@angular/core/src/facade/lang';

import {Type} from '@angular/core/src/type';

import {
	Http,
	Response,
	RequestOptionsArgs
} from '@angular/http';

import {InputMetadata} from '@angular/core/src/metadata/directives';
import {Reflector} from '@angular/core/src/reflection/reflection';

import {BrowserDomAdapter}  from '@angular/platform-browser/src/browser/browser_adapter';
import {IComponentRemoteTemplateFactory} from './IComponentRemoteTemplateFactory';

const DYNAMIC_SELECTOR: string = 'DynamicComponent';

export class DynamicComponentMetadata implements ComponentMetadataType {
	constructor(public selector: string = DYNAMIC_SELECTOR, public template: string = '') {
	}
}

@Component(new DynamicComponentMetadata())
export class DynamicComponent<TDynamicComponentType> implements OnChanges {

	@Input() componentType: {new (): TDynamicComponentType};
	@Input() componentMetaData: ComponentMetadataType;
	@Input() componentTemplate: string;
	@Input() componentTemplateUrl: string;
	@Input() componentRemoteTemplateFactory: IComponentRemoteTemplateFactory;
	@Input() componentModules: Array<any>;

	private componentInstance: ComponentRef<TDynamicComponentType>;

	protected destroyWrapper: boolean = false;

	constructor(protected element: ElementRef,
	            protected viewContainer: ViewContainerRef,
	            protected compiler: Compiler,
	            protected reflector: Reflector,
	            protected http: Http) {
	}

	/**
	 * @override
	 */
	public ngOnChanges() {
		this.getComponentTypePromise().then((module: Type<any>) => {

			this.compiler.compileModuleAndAllComponentsAsync<any>(module)
				.then((moduleWithComponentFactories: ModuleWithComponentFactories<any>) => {
					if (this.componentInstance) {
						this.componentInstance.destroy();
					}
					this.componentInstance = this.viewContainer.createComponent<TDynamicComponentType>(
						// dynamicComponentClass factory is presented here
						moduleWithComponentFactories.componentFactories[0]
					);

					this.applyPropertiesToDynamicComponent(this.componentInstance.instance);

					// Remove wrapper after render the component
					if (this.destroyWrapper) {
						new BrowserDomAdapter().remove(this.element.nativeElement);
					}
				});
		});
	}

	protected getComponentTypePromise(): Promise<Type<any>> {
		return new Promise((resolve: (value: Type<any>) => void) => {
			if (!isBlank(this.componentMetaData)) {
				resolve(
					this.makeComponentModule(this.componentMetaData)
				);
			} else if (!isBlank(this.componentTemplate)) {
				resolve(
					this.makeComponentModule(this.componentTemplate)
				);
			} else if (!isBlank(this.componentTemplateUrl)) {
				this.loadRemoteTemplate(this.componentTemplateUrl, resolve);
			} else {
				resolve(this.makeComponentModule(null, this.componentType));
			}
		});
	}

	private loadRemoteTemplate(url: string, resolve: (value: Type<any>) => void) {
		let requestArgs: RequestOptionsArgs = {withCredentials: true};
		if (!isBlank(this.componentRemoteTemplateFactory)) {
			requestArgs = this.componentRemoteTemplateFactory.buildRequestOptions();
		}

		this.http.get(url, requestArgs)
			.subscribe((response: Response) => {
				if (response.status === 301 || response.status === 302) {
					const chainedUrl: string = response.headers.get('Location');
					if (!isBlank(chainedUrl)) {
						this.loadRemoteTemplate(chainedUrl, resolve);
					}
				} else {
					resolve(
						this.makeComponentModule(!isBlank(this.componentRemoteTemplateFactory)
							? this.componentRemoteTemplateFactory.parseResponse(response)
							: response.text())
					);
				}
			}, (response: Response) => {
				console.error('[$DynamicComponent] loadRemoteTemplate error response:', response);

				resolve(
					this.makeComponentModule(['[ERROR]:', response.status].join(''))
				);
			});
	}

	private makeComponentModule(template: string|ComponentMetadataType, componentType?: {new (): TDynamicComponentType}): Type<any> {
		componentType = componentType || this.makeComponent(template);
		const componentModules: Array<any> = this.componentModules;
		@NgModule({
			declarations: [componentType],
			imports: [CommonModule].concat(componentModules || [])
		})
		class dynamicComponentModule {
		}
		return dynamicComponentModule;
	}

	private makeComponent(template: string|ComponentMetadataType): Type<TDynamicComponentType> {
		if (isString(template)) {
			@Component({selector: DYNAMIC_SELECTOR, template: template})
			class dynamicComponentClass {
				constructor() {
				}
			}
			return dynamicComponentClass as Type<TDynamicComponentType>;
		} else {
			@Component(template)
			class dynamicComponentClass {
				constructor() {
				}
			}
			return dynamicComponentClass as Type<TDynamicComponentType>;
		}
	}

	private applyPropertiesToDynamicComponent(instance: TDynamicComponentType) {
		const placeholderComponentMetaData: {[key: string]: Type<any>[];} =
			this.reflector.propMetadata(this.constructor as Type<any>);

		for (let prop of Object.keys(this)) {
			if (this.hasInputMetadataAnnotation(placeholderComponentMetaData[prop])) {
				if (isPresent(instance[prop])) {
					console.warn('[$DynamicComponent] The property', prop, 'will be overwritten for the component', instance);
				}
				instance[prop] = this[prop];
			}
		}
	}

	private hasInputMetadataAnnotation(metaDataByProperty: Array<Type<any>>): boolean {
		return isArray(metaDataByProperty) && !!metaDataByProperty.find((decorator: Type<any>) => decorator instanceof InputMetadata);
	}
}
