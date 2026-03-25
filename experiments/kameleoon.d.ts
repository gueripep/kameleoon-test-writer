declare namespace Kameleoon {
    export namespace API {
        export namespace Core {
            export function enableLegalConsent(module?: "PRODUCT_RECOMMENDATION" | "AB_TESTING" | "PERSONALIZATION" | "BOTH"): void;
            export function disableLegalConsent(module?: "PRODUCT_RECOMMENDATION" | "AB_TESTING" | "PERSONALIZATION" | "BOTH"): void;
            export function enableSinglePageSupport(): void;
            export function enableDynamicRefresh(): void;
            export function getConfiguration(): Configuration;
            export function load(): void;
            export function processRedirect(redirectionURL: string): void;
            export function runWhenConditionTrue(conditionFunction: () => boolean, callback: () => void, pollingInterval?: number): void;
            export function runWhenElementPresent(selector: string, callback: (elements: HTMLElement[]) => void, pollingInterval?: number | null, isDynamicElement?: boolean): void;
            export function runWhenShadowRootElementPresent(parentSelector: string, shadowRootElementSelector: string, callback: (elements: HTMLElement[]) => void, isDynamicElement?: boolean): void;
        }

        export namespace Goals {
            export function cancelConversion(goalNameOrID: string | number): void;
            export function processConversion(goalNameOrID: string | number, revenue?: number, metadata?: Record<number, any>): void;
        }

        export namespace Data {
            export function readLocalData(key: string): string | null;
            export function performRemoteSynchronization(key?: string, value?: string, currentVisitOnly?: boolean): void;
            export function resetCustomData(name: string): void;
            export function retrieveDataFromRemoteSource(key: string, callback: (data: any) => void): void;
            export function setCustomData(customDataNameOrIndex: string | number, value: string | number | boolean | any[], overwrite?: boolean): void;
            export function writeLocalData(key: string, value: string, persistent?: boolean): void;
        }

        export namespace Events {
            export function trigger(eventName: string): void;
        }

        export namespace Tracking {
            export function processOmniture(omnitureObject: any): void;
        }

        export namespace Products {
            export function obtainRecommendedProducts(code: string, params: object, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;
            export function trackAddToCart(productID: string, unitPrice?: number, amount?: number, parameters?: object): void;
            export function trackAddToWishList(productId: string, quantity?: number): void;
            export function trackCategoryView(categoryID: string | number): void;
            export function trackProductView(productID: string, productData: Product | object): void;
            export function trackSearchQuery(search_query: string): void;
            export function trackTransaction(products: {productID: string, quantity: number}[], params?: object): void;
            export function obtainInstantSearchProducts(search_query: object, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;
            export function obtainFullSearchProducts(search_query: object, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;
            export function obtainProductInteractions(eans: string | string[], callback: (response: any) => void, timeBegin?: number, timeEnd?: number): void;
            export function obtainProductData(eans: string | string[], callback: (response: any) => void, parameters?: object): void;
            export function obtainRecommendedCollections(collectionId: string, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;
        }

        export namespace Experiments {
            export function assignVariation(experimentID: number, variationID: number, override?: boolean): void;
            export function block(experimentID: number, visit?: boolean): void;
            export function getAll(): Experiment[];
            export function getActive(): Experiment[];
            export function getById(id: number): Experiment | null;
            export function getByName(name: string): Experiment | null;
            export function getTriggeredInVisit(): Experiment[];
            export function getActivatedInVisit(): Experiment[];
            export function trigger(experimentID: number, trackingOnly?: boolean): void;
        }

        export namespace Personalizations {
            export function disable(id: number): void;
            export function getActive(): Personalization[];
            export function getAll(): Personalization[];
            export function getById(id: number): Personalization | null;
            export function getByName(name: string): Personalization | null;
            export function getTriggeredInVisit(): Personalization[];
            export function getActivatedInVisit(): Personalization[];
            export function trigger(personalizationID: number, trackingOnly?: boolean): void;
        }

        export namespace Variations {
            export function execute(variationID: number): void;
        }

        export namespace Segments {
            export function getAll(): Segment[];
            export function getById(id: number): Segment | null;
            export function getByName(name: string): Segment | null;
            export function reevaluate(id: number): void;
            export function trigger(id: number): void;
        }

        export namespace Triggers {
            export function getAll(): Trigger[];
            export function getById(id: number): Trigger | null;
            export function getByName(name: string): Trigger | null;
            export function reevaluate(id: number): void;
            export function trigger(id: number): void;
        }

        export namespace Utils {
            export function addEventListener(element: HTMLElement | Window | Document, eventType: string, callback: (event: Event) => void): void;
            export function addUniversalClickListener(element: HTMLElement | Window | Document, callback: (event: Event) => void): void;
            export function clearInterval(intervalId: number): void;
            export function clearTimeout(timeoutId: number): void;
            export function createHash(string: string): string;
            export function computeHash(string: string): string;
            export function getURLParameters(): Record<string, string>;
            export function performRequest(url: string, readyStateHandler?: (this: XMLHttpRequest, event: Event) => void, errorHandler?: (this: XMLHttpRequest, event: Event) => void, timeout?: number): void;
            export function querySelectorAll(selector: string): HTMLElement[];
            export function setInterval(callback: () => void, milliseconds?: number): number;
            export function setTimeout(callback: () => void, milliseconds?: number): number;
        }

        export const Visitor: VisitorObject;
        export const CurrentVisit: Visit;

        export interface Configuration {
            siteCode: string;
            singlePageSupport: boolean;
            goals: Goal[];
            generationTime: number;
        }

        export interface VisitorObject {
            code: string;
            numberOfVisits: number;
            firstVisitStartDate: number;
            visits: Visit[];
            currentVisit: Visit;
            previousVisit: Visit | null;
            customData: Record<string, any>;
            experimentLegalConsent: boolean | null;
            personalizationLegalConsent: boolean | null;
            setVisitorCode(code: string): void;
        }

        export interface Visit {
            index: number;
            startDate: number;
            duration: number;
            pageViews: number;
            locale: string;
            device: Device;
            geolocation: Geolocation;
            weather: Weather;
            activatedExperiments: ExperimentActivation[];
            activatedPersonalizations: PersonalizationActivation[];
            conversions: Record<number, { count: number; revenue: number }>;
            customData: Record<string, any>;
            currentProduct: Product | null;
            products: Product[];
            acquisitionChannel: string;
            landingPageURL: string;
            initialConversionPredictions: Record<string, number>;
        }

        export interface Device {
            browser: string;
            browserVersion: string;
            os: string;
            type: string;
            screenHeight: number;
            screenWidth: number;
            windowHeight: number;
            windowWidth: number;
            adBlocker: boolean;
            timeZone: string;
        }

        export interface Geolocation {
            country: string;
            region: string;
            city: string;
            postalCode: string;
            latitude: number;
            longitude: number;
        }

        export interface Weather {
            temperature: string;
            humidity: string;
            pressure: string;
            windSpeed: string;
            cloudiness: number;
            sunrise: number;
            sunset: number;
            conditionCode: number;
            conditionDescription: string;
        }

        export interface Experiment {
            id: number;
            name: string;
            dateLaunched: number;
            dateModified: number;
            targetSegment: Segment;
            variations: Variation[];
            trafficDeviation: Record<number, number>;
            untrackedTrafficReallocationTime: number | null;
            goals: Goal[];
            mainGoal: Goal;
            triggered: boolean;
            active: boolean;
            triggeredInVisit: boolean;
            activatedInVisit: boolean;
            nonExpositionReason?: string;
            associatedVariation: Variation | null;
            redirectProcessed: boolean;
        }

        export interface Personalization {
            id: number;
            name: string;
            dateLaunched: number;
            dateModified: number;
            targetSegment: Segment;
            goals: Goal[];
            mainGoal: Goal;
            triggered: boolean;
            active: boolean;
            triggeredInVisit: boolean;
            activatedInVisit: boolean;
            nonExpositionReason?: string;
            associatedVariation: Variation;
        }

        export interface ExperimentActivation {
            experimentID: number;
            associatedVariationID: number;
            associatedVariation: Variation | null;
            times: number[];
        }

        export interface PersonalizationActivation {
            personalizationID: number;
            associatedVariationID: number;
            personalization: Personalization | null;
            associatedVariation: Variation | null;
            times: number[];
        }

        export interface Variation {
            id: number;
            name: string;
            associatedCampaign: Experiment | Personalization;
            instantiatedTemplate: Template | null;
            reallocationTime: number | null;
        }

        export interface Template {
            name: string;
            customFields: Record<string, string>;
        }

        export interface Goal {
            id: number;
            name: string;
            type: string;
        }

        export interface Segment {
            id: number;
            name: string;
        }

        export interface Trigger {
            id: number;
            name: string;
        }

        export interface Product {
            id: string;
            name?: string;
            sku?: string;
            categories?: Category[];
            imageURL?: string;
            price?: number;
            oldPrice?: number;
            brand?: string;
            description?: string;
            available?: boolean;
            availableQuantity?: number;
            rating?: number;
            tags?: string[];
            typePrefix?: string;
            merchantID?: string;
            groupId?: string;
            model?: string;
            leftovers?: string;
            priceMargin?: number;
            isFashion?: boolean;
            isChild?: boolean;
            isNew?: boolean;
            accessories?: string[];
            seasonality?: number[];
            params?: Param[];
            fashion?: Fashion;
            auto?: Auto;
        }

        export interface Category {
            id: string;
            name?: string;
            parent?: string;
            url?: string;
        }

        export interface Param {
            name: string;
            value: string[];
            unit?: string;
        }

        export interface Fashion {
            gender?: string;
            type?: string;
            feature?: string;
            colors?: Color[];
        }

        export interface Color {
            color: string;
            picture?: string;
        }

        export interface Auto {
            vds?: string[];
            compatibility?: Compatible[];
        }

        export interface Compatible {
            brand: string;
            model?: string;
        }
    }
}

// Global scope
declare var Kameleoon: typeof Kameleoon;
declare var kameleoonQueue: any[];
declare function triggerGoal(revenue?: number, metadata?: Record<number, any>): void;
