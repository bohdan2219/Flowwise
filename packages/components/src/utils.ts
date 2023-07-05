import axios from 'axios'
import { load } from 'cheerio'
import * as fs from 'fs'
import * as path from 'path'
import { JSDOM } from 'jsdom'
import { BaseCallbackHandler } from 'langchain/callbacks'
import { Server } from 'socket.io'
import { ChainValues } from 'langchain/dist/schema'

export const numberOrExpressionRegex = '^(\\d+\\.?\\d*|{{.*}})$' //return true if string consists only numbers OR expression {{}}
export const notEmptyRegex = '(.|\\s)*\\S(.|\\s)*' //return true if string is not empty or blank

/**
 * Get base classes of components
 *
 * @export
 * @param {any} targetClass
 * @returns {string[]}
 */
export const getBaseClasses = (targetClass: any) => {
    const baseClasses: string[] = []
    const skipClassNames = ['BaseLangChain', 'Serializable']

    if (targetClass instanceof Function) {
        let baseClass = targetClass

        while (baseClass) {
            const newBaseClass = Object.getPrototypeOf(baseClass)
            if (newBaseClass && newBaseClass !== Object && newBaseClass.name) {
                baseClass = newBaseClass
                if (!skipClassNames.includes(baseClass.name)) baseClasses.push(baseClass.name)
            } else {
                break
            }
        }
    }
    return baseClasses
}

/**
 * Serialize axios query params
 *
 * @export
 * @param {any} params
 * @param {boolean} skipIndex // Set to true if you want same params to be: param=1&param=2 instead of: param[0]=1&param[1]=2
 * @returns {string}
 */
export function serializeQueryParams(params: any, skipIndex?: boolean): string {
    const parts: any[] = []

    const encode = (val: string) => {
        return encodeURIComponent(val)
            .replace(/%3A/gi, ':')
            .replace(/%24/g, '$')
            .replace(/%2C/gi, ',')
            .replace(/%20/g, '+')
            .replace(/%5B/gi, '[')
            .replace(/%5D/gi, ']')
    }

    const convertPart = (key: string, val: any) => {
        if (val instanceof Date) val = val.toISOString()
        else if (val instanceof Object) val = JSON.stringify(val)

        parts.push(encode(key) + '=' + encode(val))
    }

    Object.entries(params).forEach(([key, val]) => {
        if (val === null || typeof val === 'undefined') return

        if (Array.isArray(val)) val.forEach((v, i) => convertPart(`${key}${skipIndex ? '' : `[${i}]`}`, v))
        else convertPart(key, val)
    })

    return parts.join('&')
}

/**
 * Handle error from try catch
 *
 * @export
 * @param {any} error
 * @returns {string}
 */
export function handleErrorMessage(error: any): string {
    let errorMessage = ''

    if (error.message) {
        errorMessage += error.message + '. '
    }

    if (error.response && error.response.data) {
        if (error.response.data.error) {
            if (typeof error.response.data.error === 'object') errorMessage += JSON.stringify(error.response.data.error) + '. '
            else if (typeof error.response.data.error === 'string') errorMessage += error.response.data.error + '. '
        } else if (error.response.data.msg) errorMessage += error.response.data.msg + '. '
        else if (error.response.data.Message) errorMessage += error.response.data.Message + '. '
        else if (typeof error.response.data === 'string') errorMessage += error.response.data + '. '
    }

    if (!errorMessage) errorMessage = 'Unexpected Error.'

    return errorMessage
}

/**
 * Returns the path of node modules package
 * @param {string} packageName
 * @returns {string}
 */
export const getNodeModulesPackagePath = (packageName: string): string => {
    const checkPaths = [
        path.join(__dirname, '..', 'node_modules', packageName),
        path.join(__dirname, '..', '..', 'node_modules', packageName),
        path.join(__dirname, '..', '..', '..', 'node_modules', packageName),
        path.join(__dirname, '..', '..', '..', '..', 'node_modules', packageName),
        path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', packageName)
    ]
    for (const checkPath of checkPaths) {
        if (fs.existsSync(checkPath)) {
            return checkPath
        }
    }
    return ''
}

/**
 * Get input variables
 * @param {string} paramValue
 * @returns {boolean}
 */
export const getInputVariables = (paramValue: string): string[] => {
    let returnVal = paramValue
    const variableStack = []
    const inputVariables = []
    let startIdx = 0
    const endIdx = returnVal.length

    while (startIdx < endIdx) {
        const substr = returnVal.substring(startIdx, startIdx + 1)

        // Store the opening double curly bracket
        if (substr === '{') {
            variableStack.push({ substr, startIdx: startIdx + 1 })
        }

        // Found the complete variable
        if (substr === '}' && variableStack.length > 0 && variableStack[variableStack.length - 1].substr === '{') {
            const variableStartIdx = variableStack[variableStack.length - 1].startIdx
            const variableEndIdx = startIdx
            const variableFullPath = returnVal.substring(variableStartIdx, variableEndIdx)
            inputVariables.push(variableFullPath)
            variableStack.pop()
        }
        startIdx += 1
    }
    return inputVariables
}

/**
 * Crawl all available urls given a domain url and limit
 * @param {string} url
 * @param {number} limit
 * @returns {string[]}
 */
export const getAvailableURLs = async (url: string, limit: number) => {
    try {
        const availableUrls: string[] = []

        console.info(`Crawling: ${url}`)
        availableUrls.push(url)

        const response = await axios.get(url)
        const $ = load(response.data)

        const relativeLinks = $("a[href^='/']")
        console.info(`Available Relative Links: ${relativeLinks.length}`)
        if (relativeLinks.length === 0) return availableUrls

        limit = Math.min(limit + 1, relativeLinks.length) // limit + 1 is because index start from 0 and index 0 is occupy by url
        console.info(`True Limit: ${limit}`)

        // availableUrls.length cannot exceed limit
        for (let i = 0; availableUrls.length < limit; i++) {
            if (i === limit) break // some links are repetitive so it won't added into the array which cause the length to be lesser
            console.info(`index: ${i}`)
            const element = relativeLinks[i]

            const relativeUrl = $(element).attr('href')
            if (!relativeUrl) continue

            const absoluteUrl = new URL(relativeUrl, url).toString()
            if (!availableUrls.includes(absoluteUrl)) {
                availableUrls.push(absoluteUrl)
                console.info(`Found unique relative link: ${absoluteUrl}`)
            }
        }

        return availableUrls
    } catch (err) {
        throw new Error(`getAvailableURLs: ${err?.message}`)
    }
}

function getURLsFromHTML(htmlBody: string, baseURL: string): string[] {
    const dom = new JSDOM(htmlBody)
    const linkElements = dom.window.document.querySelectorAll('a')
    const urls: string[] = []
    for (const linkElement of linkElements) {
        if (linkElement.href.slice(0, 1) === '/') {
            try {
                const urlObj = new URL(baseURL + linkElement.href)
                urls.push(urlObj.href) //relative
            } catch (err) {
                if (process.env.DEBUG === 'true') console.error(`error with relative url: ${err.message}`)
                continue
            }
        } else {
            try {
                const urlObj = new URL(linkElement.href)
                urls.push(urlObj.href) //absolute
            } catch (err) {
                if (process.env.DEBUG === 'true') console.error(`error with absolute url: ${err.message}`)
                continue
            }
        }
    }
    return urls
}

function normalizeURL(urlString: string): string {
    const urlObj = new URL(urlString)
    const hostPath = urlObj.hostname + urlObj.pathname
    if (hostPath.length > 0 && hostPath.slice(-1) == '/') {
        // handling trailing slash
        return hostPath.slice(0, -1)
    }
    return hostPath
}

export async function crawl(baseURL: string, currentURL: string, pages: string[], limit: number): Promise<string[]> {
    const baseURLObj = new URL(baseURL)
    const currentURLObj = new URL(currentURL)

    if (limit !== 0 && pages.length === limit) return pages

    if (baseURLObj.hostname !== currentURLObj.hostname) return pages

    const normalizeCurrentURL = baseURLObj.protocol + '//' + normalizeURL(currentURL)
    if (pages.includes(normalizeCurrentURL)) {
        return pages
    }

    pages.push(normalizeCurrentURL)

    if (process.env.DEBUG === 'true') console.info(`actively crawling ${currentURL}`)
    try {
        const resp = await fetch(currentURL)

        if (resp.status > 399) {
            if (process.env.DEBUG === 'true') console.error(`error in fetch with status code: ${resp.status}, on page: ${currentURL}`)
            return pages
        }

        const contentType: string | null = resp.headers.get('content-type')
        if ((contentType && !contentType.includes('text/html')) || !contentType) {
            if (process.env.DEBUG === 'true') console.error(`non html response, content type: ${contentType}, on page: ${currentURL}`)
            return pages
        }

        const htmlBody = await resp.text()
        const nextURLs = getURLsFromHTML(htmlBody, baseURL)
        for (const nextURL of nextURLs) {
            pages = await crawl(baseURL, nextURL, pages, limit)
        }
    } catch (err) {
        if (process.env.DEBUG === 'true') console.error(`error in fetch url: ${err.message}, on page: ${currentURL}`)
    }
    return pages
}

export async function webCrawl(stringURL: string, limit: number): Promise<string[]> {
    const URLObj = new URL(stringURL)
    const modifyURL = stringURL.slice(-1) === '/' ? stringURL.slice(0, -1) : stringURL
    return await crawl(URLObj.protocol + '//' + URLObj.hostname, modifyURL, [], limit)
}

/**
 * Custom chain handler class
 */
export class CustomChainHandler extends BaseCallbackHandler {
    name = 'custom_chain_handler'
    isLLMStarted = false
    socketIO: Server
    socketIOClientId = ''
    skipK = 0 // Skip streaming for first K numbers of handleLLMStart
    returnSourceDocuments = false

    constructor(socketIO: Server, socketIOClientId: string, skipK?: number, returnSourceDocuments?: boolean) {
        super()
        this.socketIO = socketIO
        this.socketIOClientId = socketIOClientId
        this.skipK = skipK ?? this.skipK
        this.returnSourceDocuments = returnSourceDocuments ?? this.returnSourceDocuments
    }

    handleLLMStart() {
        if (this.skipK > 0) this.skipK -= 1
    }

    handleLLMNewToken(token: string) {
        if (this.skipK === 0) {
            if (!this.isLLMStarted) {
                this.isLLMStarted = true
                this.socketIO.to(this.socketIOClientId).emit('start', token)
            }
            this.socketIO.to(this.socketIOClientId).emit('token', token)
        }
    }

    handleLLMEnd() {
        this.socketIO.to(this.socketIOClientId).emit('end')
    }

    handleChainEnd(outputs: ChainValues): void | Promise<void> {
        if (this.returnSourceDocuments) {
            this.socketIO.to(this.socketIOClientId).emit('sourceDocuments', outputs?.sourceDocuments)
        }
    }
}

export const availableDependencies = [
    '@dqbd/tiktoken',
    '@getzep/zep-js',
    '@huggingface/inference',
    '@pinecone-database/pinecone',
    '@supabase/supabase-js',
    'axios',
    'cheerio',
    'chromadb',
    'cohere-ai',
    'd3-dsv',
    'form-data',
    'graphql',
    'html-to-text',
    'langchain',
    'linkifyjs',
    'mammoth',
    'moment',
    'node-fetch',
    'pdf-parse',
    'pdfjs-dist',
    'playwright',
    'puppeteer',
    'srt-parser-2',
    'typeorm',
    'weaviate-ts-client'
]
