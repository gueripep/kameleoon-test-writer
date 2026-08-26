declare namespace Kameleoon {
    export namespace API {
        /**
         * This module contains functions for implementing front-end A/B testing variations without flickering[cite: 7].
         */
        export namespace Core {
            /**
             * Activates Kameleoon's normal operation mode[cite: 19].
             */
            export function enableLegalConsent(module?: "PRODUCT_RECOMMENDATION" | "AB_TESTING" | "PERSONALIZATION" | "BOTH"): void;

            /**
             * Call the disableLegalConsent() method when a visitor declines the use of Kameleoon. This method disables normal operation mode[cite: 37].
             */
            export function disableLegalConsent(module?: "PRODUCT_RECOMMENDATION" | "AB_TESTING" | "PERSONALIZATION" | "BOTH"): void;

            /**
             * Reloads the Kameleoon engine when the active URL changes, regardless of browser page loads[cite: 53].
             */
            export function enableSinglePageSupport(): void;

            /**
             * Detects element changes and reapplies Graphic Editor modifications[cite: 62].
             */
            export function enableDynamicRefresh(): void;

            /**
             * Returns a reference to the Configuration object, which contains global constant values for the site's Kameleoon configuration[cite: 76].
             */
            export function getConfiguration(): Configuration;

            /**
             * Initializes the Kameleoon engine[cite: 86].
             */
            export function load(): void;

            /**
             * Redirects the browser to another URL, typically for split A/B experiments[cite: 100].
             */
            export function processRedirect(redirectionURL: string): void;

            /**
             * Executes the callback function when the conditionFunction returns true[cite: 111].
             */
            export function runWhenConditionTrue(conditionFunction: () => boolean, callback: () => void, pollingInterval?: number): void;

            /**
             * Executes the callback function when a specific element appears in the DOM[cite: 142].
             */
            export function runWhenElementPresent(selector: string, callback: (elements: HTMLElement[]) => void, pollingInterval?: number | null, isDynamicElement?: boolean): void;

            /**
             * Executes the callback function when a specific element appears in a shadow DOM set to mode: open[cite: 167].
             */
            export function runWhenShadowRootElementPresent(parentSelector: string, shadowRootElementSelector: string, callback: (elements: HTMLElement[]) => void, isDynamicElement?: boolean): void;
        }

        /**
         * This module manages goal triggering and conversion data, including purchase confirmations and revenue registration[cite: 176].
         */
        export namespace Goals {
            /**
             * Cancels a conversion that you triggered during the current visit[cite: 186].
             */
            export function cancelConversion(goalNameOrID: string | number): void;

            /**
             * Triggers a conversion[cite: 210].
             */
            export function processConversion(goalNameOrID: string | number, revenue?: number, metadata?: Record<number, any>): void;
        }

        /**
         * This module provides methods to set custom data for tracking customer or visit characteristics[cite: 341].
         */
        export namespace Data {
            /**
             * Reads local data you previously stored through writeLocalData()[cite: 350].
             */
            export function readLocalData(key: string): string | null;

            /**
             * Triggers a Server Synchronization Call (SSC) to the Data API[cite: 363].
             */
            export function performRemoteSynchronization(key?: string, value?: string, currentVisitOnly?: boolean): void;

            /**
             * Resets a custom data value[cite: 376].
             */
            export function resetCustomData(name: string): void;

            /**
             * Retrieves data stored on a remote Kameleoon server with the specified key[cite: 399].
             */
            export function retrieveDataFromRemoteSource(key: string, callback: (data: any) => void): void;

            /**
             * Sets a custom data value[cite: 423].
             */
            export function setCustomData(customDataNameOrIndex: string | number, value: string | number | boolean | any[], overwrite?: boolean): void;

            /**
             * Records local data in the visitor's browser for later retrieval through readLocalData()[cite: 428].
             */
            export function writeLocalData(key: string, value: string, persistent?: boolean): void;
        }

        /**
         * This module triggers custom events for experiment and personalization targeting[cite: 438].
         */
        export namespace Events {
            /**
             * Triggers a custom event for targeting segments[cite: 441].
             */
            export function trigger(eventName: string): void;
        }

        /**
         * This module integrates Kameleoon results with third-party tracking and analytics platforms, such as Adobe Analytics (Omniture)[cite: 445].
         */
        export namespace Tracking {
            /**
             * Sends an additional hit only if an experiment or personalization triggers after the main tracking call[cite: 464].
             */
            export function processOmniture(omnitureObject: any): void;
        }

        /**
         * This module provides access to the product catalog[cite: 470].
         */
        export namespace Products {
            /**
             * Retrieves recommended products computed by the specified algorithm through an asynchronous server call[cite: 498].
             */
            export function obtainRecommendedProducts(code: string, params: object, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;

            /**
             * Triggers when a visitor adds a product to the shopping cart[cite: 532].
             */
            export function trackAddToCart(productID: string, unitPrice?: number, amount?: number, parameters?: object): void;

            /**
             * Executes when a visitor adds or removes a product from the wish list or favorites[cite: 545].
             */
            export function trackAddToWishList(productId: string, quantity?: number): void;

            /**
             * Executes for each category page view during a session[cite: 560].
             */
            export function trackCategoryView(categoryID: string | number): void;

            /**
             * Executes for each product view during a session[cite: 635].
             */
            export function trackProductView(productID: string, productData: Product | object): void;

            /**
             * Records user search queries[cite: 641].
             */
            export function trackSearchQuery(search_query: string): void;

            /**
             * Executes when a transaction or purchase occurs[cite: 665].
             */
            export function trackTransaction(products: { productID: string, quantity: number }[], params?: object): void;

            /**
             * Retrieves personalized instant search results from Kameleoon Search through an asynchronous server call[cite: 690].
             */
            export function obtainInstantSearchProducts(search_query: object, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;

            /**
             * Retrieves full search results from the Kameleoon Search solution with filtering options[cite: 730].
             */
            export function obtainFullSearchProducts(search_query: object, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;

            /**
             * Retrieves interaction metrics for products tracked via trackProductView(), trackTransaction(), or trackAddToCart()[cite: 795].
             */
            export function obtainProductInteractions(eans: string | string[], callback: (response: any) => void, timeBegin?: number, timeEnd?: number): void;

            /**
             * Retrieves product information for items sent via trackProductView()[cite: 819].
             */
            export function obtainProductData(eans: string | string[], callback: (response: any) => void, parameters?: object): void;

            /**
             * Retrieves products from the specified collection[cite: 834].
             */
            export function obtainRecommendedCollections(collectionId: string, successCallback: (response: any) => void, errorCallback?: (error: any) => void): void;
        }

        /**
         * This module provides methods to access live experiments[cite: 851].
         */
        export namespace Experiments {
            /**
             * Forces the association of a specific variation for an experiment, which overrides the standard allocation algorithm[cite: 870].
             */
            export function assignVariation(experimentID: number, variationID: number, override?: boolean): void;

            /**
             * Prevents an experiment from triggering or activating, including manual calls through trigger()[cite: 881].
             */
            export function block(experimentID: number, visit?: boolean): void;

            /**
             * Returns all live experiments (running, not draft/paused/stopped)[cite: 891].
             */
            export function getAll(): Experiment[];

            /**
             * Returns active experiments for the current visit and page[cite: 902].
             */
            export function getActive(): Experiment[];

            /**
             * Returns the experiment for the specified ID[cite: 912].
             */
            export function getById(id: number): Experiment | null;

            /**
             * Returns the experiment for the specified name[cite: 927].
             */
            export function getByName(name: string): Experiment | null;

            /**
             * Returns all experiments triggered during the current visit[cite: 938].
             */
            export function getTriggeredInVisit(): Experiment[];

            /**
             * Returns all experiments activated during the current visit[cite: 952].
             */
            export function getActivatedInVisit(): Experiment[];

            /**
             * Forces an experiment to trigger, bypassing targeting segment conditions[cite: 958].
             */
            export function trigger(experimentID: number, trackingOnly?: boolean): void;
        }

        /**
         * This module provides methods to access live personalizations[cite: 967].
         */
        export namespace Personalizations {
            /**
             * Marks a personalization as disabled[cite: 970].
             */
            export function disable(id: number): void;

            /**
             * Returns active personalizations for the current visit and page[cite: 979].
             */
            export function getActive(): Personalization[];

            /**
             * Returns all live personalizations (running, not draft/paused/stopped)[cite: 995].
             */
            export function getAll(): Personalization[];

            /**
             * Returns the personalization for the specified ID[cite: 1003].
             */
            export function getById(id: number): Personalization | null;

            /**
             * Returns the personalization for the specified name[cite: 1018].
             */
            export function getByName(name: string): Personalization | null;

            /**
             * Returns all personalizations triggered during the current visit[cite: 1030].
             */
            export function getTriggeredInVisit(): Personalization[];

            /**
             * Returns all personalizations activated during the current visit[cite: 1044].
             */
            export function getActivatedInVisit(): Personalization[];

            /**
             * Forces a personalization to trigger, bypassing targeting segment conditions[cite: 1050].
             */
            export function trigger(personalizationID: number, trackingOnly?: boolean): void;
        }

        /**
         * This module provides methods to manage variations[cite: 1059].
         */
        export namespace Variations {
            /**
             * Executes JavaScript and applies CSS for the specified variation ID[cite: 1068].
             */
            export function execute(variationID: number): void;
        }

        /**
         * This module provides methods to manage segments and targeting[cite: 1070].
         */
        export namespace Segments {
            /**
             * Returns all live segments, including those associated with experiments, personalizations, or Audience tracking[cite: 1073].
             */
            export function getAll(): Segment[];

            /**
             * Returns the segment for the specified ID[cite: 1082].
             */
            export function getById(id: number): Segment | null;

            /**
             * Returns the segment for the specified name[cite: 1089].
             */
            export function getByName(name: string): Segment | null;

            /**
             * Forces an immediate re-evaluation of the targeting conditions for the specified segment[cite: 1103].
             */
            export function reevaluate(id: number): void;

            /**
             * Forces a segment trigger for the current visitor and bypasses targeting conditions[cite: 1110].
             */
            export function trigger(id: number): void;
        }

        /**
         * This module provides methods to manage triggers and targeting[cite: 1114].
         */
        export namespace Triggers {
            /**
             * Returns all live triggers, including those associated with experiments, personalizations, or Audience tracking[cite: 1117].
             */
            export function getAll(): Trigger[];

            /**
             * Returns the trigger for the specified ID[cite: 1126].
             */
            export function getById(id: number): Trigger | null;

            /**
             * Returns the trigger for the specified name[cite: 1133].
             */
            export function getByName(name: string): Trigger | null;

            /**
             * Forces an immediate re-evaluation of the targeting conditions for the specified trigger[cite: 1148].
             */
            export function reevaluate(id: number): void;

            /**
             * Forces a trigger to fire for the current visitor and bypasses targeting conditions[cite: 1155].
             */
            export function trigger(id: number): void;
        }

        /**
         * This module provides utility methods for common operations[cite: 1163].
         */
        export namespace Utils {
            /**
             * Attaches an event handler to the specified element[cite: 1174].
             */
            export function addEventListener(element: HTMLElement | Window | Document, eventType: string, callback: (event: Event) => void): void;

            /**
             * Attaches a click handler that listens for mouse clicks on desktop and touchdown events on mobile devices and tablets[cite: 1190].
             */
            export function addUniversalClickListener(element: HTMLElement | Window | Document, callback: (event: Event) => void): void;

            /**
             * Clears a timer you set through setInterval()[cite: 1205].
             */
            export function clearInterval(intervalId: number): void;

            /**
             * Clears a timer you set through setTimeout()[cite: 1223].
             */
            export function clearTimeout(timeoutId: number): void;

            /**
             * Computes a hash from a string[cite: 1230].
             */
            export function createHash(string: string): string;

            /**
             * Computes a hash from a string[cite: 1230].
             */
            export function computeHash(string: string): string;

            /**
             * Parses the current URL and returns all detected parameters[cite: 1245].
             */
            export function getURLParameters(): Record<string, string>;

            /**
             * Initiates a call to a remote web server[cite: 1266].
             */
            export function performRequest(url: string, readyStateHandler?: (this: XMLHttpRequest, event: Event) => void, errorHandler?: (this: XMLHttpRequest, event: Event) => void, timeout?: number): void;

            /**
             * Returns all document elements matching the specified CSS selectors as a static NodeList object[cite: 1278].
             */
            export function querySelectorAll(selector: string): HTMLElement[];

            /**
             * Executes a function or expression at the specified interval in milliseconds[cite: 1297].
             */
            export function setInterval(callback: () => void, milliseconds?: number): number;

            /**
             * Executes a function or expression after the specified number of milliseconds[cite: 1311].
             */
            export function setTimeout(callback: () => void, milliseconds?: number): number;
        }

        /**
         * A shortcut to obtain a reference to the current Visitor object[cite: 1322].
         */
        export const Visitor: VisitorObject;

        /**
         * A shortcut to obtain a reference to the current, in-progress Visit object[cite: 1337].
         */
        export const CurrentVisit: Visit;

        /**
         * Holds global constant values related to the current configuration of Kameleoon on this site[cite: 1346].
         */
        export interface Configuration {
            siteCode: string;
            singlePageSupport: boolean;
            goals: Goal[];
            generationTime: number;
        }

        /**
         * Contains visitor-scoped data independent of specific visits[cite: 1350].
         */
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

            /**
             * Overrides the Kameleoon VisitorCode, which is a unique identifier randomly generated for every visitor[cite: 1332].
             */
            setVisitorCode(code: string): void;
        }

        /**
         * Represents a single visit and contains real-time information that Kameleoon gathers[cite: 1365].
         */
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

        /**
         * Contains data about the device for a given visit[cite: 1382].
         */
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

        /**
         * Contains data about the physical location of the visitor for a given visit[cite: 1391].
         */
        export interface Geolocation {
            country: string;
            region: string;
            city: string;
            postalCode: string;
            latitude: number;
            longitude: number;
        }

        /**
         * Contains data about the weather conditions occurring at the time of the visit[cite: 1400].
         */
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

        /**
         * Represents a Kameleoon A/B test. Core properties include the segment and associated variations[cite: 1409].
         */
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

        /**
         * Represents a Kameleoon personalization action for a specific segment[cite: 1424].
         */
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

        /**
         * Represents an experiment activated during a specific visit[cite: 1439].
         */
        export interface ExperimentActivation {
            experimentID: number;
            associatedVariationID: number;
            associatedVariation: Variation | null;
            times: number[];
        }

        /**
         * Represents a personalization activated during a specific visit[cite: 1446].
         */
        export interface PersonalizationActivation {
            personalizationID: number;
            associatedVariationID: number;
            personalization: Personalization | null;
            associatedVariation: Variation | null;
            times: number[];
        }

        /**
         * Represents a component of an Experiment[cite: 1456].
         */
        export interface Variation {
            id: number;
            name: string;
            associatedCampaign: Experiment | Personalization;
            instantiatedTemplate: Template | null;
            reallocationTime: number | null;
        }

        /**
         * Represents an instantiated Widget template[cite: 1469].
         */
        export interface Template {
            name: string;
            customFields: Record<string, string>;
        }

        /**
         * Represents a Key Performance Indicator (KPI) defined in the Kameleoon app[cite: 1474].
         */
        export interface Goal {
            id: number;
            name: string;
            type: string;
        }

        /**
         * Contains criteria that a visit must fulfill to belong to the segment[cite: 1482].
         */
        export interface Segment {
            id: number;
            name: string;
        }

        /**
         * Contains criteria that a visit must fulfill to fire the trigger[cite: 1487].
         */
        export interface Trigger {
            id: number;
            name: string;
        }

        /**
         * Describes items in a catalog[cite: 1496].
         */
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

        /**
         * An optional generic field that allows you to upload custom information about a product that does not fit in other fields[cite: 1512].
         */
        export interface Param {
            name: string;
            value: string[];
            unit?: string;
        }


        /**
         * An optional generic field that allows you to upload custom information about the product[cite: 1517].
         */
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

        /**
         * An optional generic field that allows you to upload custom information about the product[cite: 1529].
         */
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


/**
 * Short version for goal code
 */
declare function triggerGoal(): void;

/**
 * Common global variables often encountered in external testing and tracking.
 */
declare interface Window {
    tc_vars?: any;
    dataLayer?: any[];
    kameleoonQueue?: any[];
}