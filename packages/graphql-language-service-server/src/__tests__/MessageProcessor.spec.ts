import { MessageProcessor } from '../MessageProcessor';

jest.mock('../Logger');

import { NoopLogger } from '../Logger';
import mockfs from 'mock-fs';
import { join } from 'node:path';
import { MockProject } from './__utils__/MockProject';
import { readFileSync } from 'node:fs';
import { FileChangeTypeKind } from 'graphql-language-service';
import { FileChangeType } from 'vscode-languageserver';
import { readFile } from 'node:fs/promises';

describe('MessageProcessor with no config', () => {
  let messageProcessor: MessageProcessor;
  const mockRoot = join('/tmp', 'test');
  let loggerSpy: jest.SpyInstance;
  let mockProcessor;

  beforeEach(() => {
    mockProcessor = (query: string, config?: string) => {
      const items = {
        'query.graphql': query,
      };
      if (config) {
        items['graphql.config.js'] = config;
      }
      const files: Parameters<typeof mockfs>[0] = {
        [mockRoot]: mockfs.directory({
          items,
        }),
        'node_modules/parse-json': mockfs.load('node_modules/parse-json'),
        'node_modules/error-ex': mockfs.load('node_modules/error-ex'),
        'node_modules/is-arrayish': mockfs.load('node_modules/is-arrayish'),
        'node_modules/json-parse-even-better-errors': mockfs.load(
          'node_modules/json-parse-even-better-errors',
        ),
        'node_modules/lines-and-columns': mockfs.load(
          'node_modules/lines-and-columns',
        ),
        'node_modules/@babel': mockfs.load('node_modules/@babel'),
      };
      mockfs(files);
      const logger = new NoopLogger();
      loggerSpy = jest.spyOn(logger, 'error');
      messageProcessor = new MessageProcessor({
        // @ts-ignore
        connection: {
          // @ts-ignore
          get workspace() {
            return {
              async getConfiguration() {
                return [];
              },
            };
          },
        },
        logger,
        graphqlFileExtensions: ['graphql'],
        loadConfigOptions: { rootDir: mockRoot },
      });
    };
  });

  afterEach(() => {
    mockfs.restore();
  });
  it('fails to initialize with empty config file', async () => {
    mockProcessor('query { foo }', '');
    await messageProcessor.handleInitializeRequest(
      // @ts-ignore
      {
        rootPath: mockRoot,
      },
      null,
      mockRoot,
    );
    await messageProcessor.handleDidOpenOrSaveNotification({
      textDocument: {
        text: 'query { foo }',
        uri: `${mockRoot}/query.graphql`,
        version: 1,
      },
    });
    expect(messageProcessor._isInitialized).toEqual(false);
    expect(messageProcessor._isGraphQLConfigMissing).toEqual(true);
    expect(loggerSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /GraphQL Config file is not available in the provided config directory/,
      ),
    );
  });
  it('fails to initialize with no config file present', async () => {
    mockProcessor('query { foo }');
    await messageProcessor.handleInitializeRequest(
      // @ts-ignore
      {
        rootPath: mockRoot,
      },
      null,
      mockRoot,
    );
    await messageProcessor.handleDidOpenOrSaveNotification({
      textDocument: {
        text: 'query { foo }',
        uri: `${mockRoot}/query.graphql`,
        version: 1,
      },
    });
    expect(messageProcessor._isInitialized).toEqual(false);
    expect(messageProcessor._isGraphQLConfigMissing).toEqual(true);
    expect(loggerSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /GraphQL Config file is not available in the provided config directory/,
      ),
    );
  });
  it('initializes when presented with a valid config later', async () => {
    mockProcessor('query { foo }');
    await messageProcessor.handleInitializeRequest(
      // @ts-ignore
      {
        rootPath: mockRoot,
      },
      null,
      mockRoot,
    );
    await messageProcessor.handleDidOpenOrSaveNotification({
      textDocument: {
        text: 'query { foo }',
        uri: `${mockRoot}/query.graphql`,
        version: 1,
      },
    });
    expect(messageProcessor._isInitialized).toEqual(false);
    expect(loggerSpy).toHaveBeenCalledTimes(1);

    // todo: get mockfs working with in-test file changes
    // mockfs({
    //   [mockRoot]: mockfs.directory({
    //     mode: 0o755,
    //     items: {
    //       'schema.graphql':
    //         'type Query { foo: String }\nschema { query: Query }',
    //       'graphql.config.js': mockfs.file({
    //         content: 'module.exports = { schema: "schema.graphql" };',
    //         mode: 0o644,
    //       }),
    //       'query.graphql': 'query { foo }',
    //     },
    //   }),
    // });
    // // console.log(readdirSync(`${mockRoot}`));
    // await messageProcessor.handleDidOpenOrSaveNotification({
    //   textDocument: {
    //     text: 'module.exports = { schema: "schema.graphql" }',
    //     uri: `${mockRoot}/graphql.config.js`,
    //     version: 2,
    //   },
    // });

    // expect(messageProcessor._isGraphQLConfigMissing).toEqual(false);

    // expect(loggerSpy).toHaveBeenCalledWith(
    //   expect.stringMatching(
    //     /GraphQL Config file is not available in the provided config directory/,
    //   ),
    // );
  });
});

describe('project with simple config and graphql files', () => {
  afterEach(() => {
    mockfs.restore();
  });
  it.only('caches files and schema with .graphql file config', async () => {
    const project = new MockProject({
      files: [
        [
          'graphql.config.json',
          '{ "schema": "./schema.graphql", "documents": "./**.graphql" }',
        ],
        [
          'schema.graphql',
          'type Query { foo: Foo }\n\ntype Foo { bar: String }',
        ],
        ['query.graphql', 'query { bar ...B }'],
        ['fragments.graphql', 'fragment B on Foo { bar }'],
      ],
    });
    await project.lsp.handleInitializeRequest({
      rootPath: project.root,
      rootUri: project.root,
      capabilities: {},
      processId: 200,
      workspaceFolders: null,
    });
    await project.lsp.handleDidOpenOrSaveNotification({
      textDocument: { uri: project.uri('query.graphql') },
    });
    expect(project.lsp._logger.error).not.toHaveBeenCalled();
    // console.log(project.lsp._graphQLCache.getSchema('schema.graphql'));
    expect(await project.lsp._graphQLCache.getSchema()).toBeDefined();
    // TODO: for some reason the cache result formats the graphql query??
    expect(
      project.lsp._textDocumentCache.get(project.uri('query.graphql'))
        .contents[0].query,
    ).toContain('...B');
    const definitions = await project.lsp.handleDefinitionRequest({
      textDocument: { uri: project.uri('fragments.graphql') },
      position: { character: 16, line: 0 },
    });
    expect(definitions[0].uri).toEqual(project.uri('schema.graphql'));
    expect(JSON.parse(JSON.stringify(definitions[0].range.end))).toEqual({
      line: 2,
      character: 24,
    });
    // TODO: get mockfs working so we can change watched files.
    // currently, when I run this, it removes the file entirely
    project.changeFile(
      'schema.graphql',
      'type Query { foo: Foo }\n\n type Test { test: String }\n\n\n\n\ntype Foo { bad: Int, bar: String }',
    );
    await project.lsp.handleWatchedFilesChangedNotification({
      changes: [
        { uri: project.uri('schema.graphql'), type: FileChangeType.Changed },
      ],
    });
    const definitionsAgain = await project.lsp.handleDefinitionRequest({
      textDocument: { uri: project.uri('fragments.graphql') },
      position: { character: 16, line: 0 },
    });
    expect(definitionsAgain[0].uri).toEqual(project.uri('schema.graphql'));
    // TODO: this should change when a watched file changes???
    expect(JSON.parse(JSON.stringify(definitions[0].range.end))).toEqual({
      line: 2,
      character: 24,
    });
  });
  it('caches files and schema with a URL config', async () => {
    const project = new MockProject({
      files: [
        [
          'graphql.config.json',
          '{ "schema": "https://rickandmortyapi.com/graphql", "documents": "./**.graphql" }',
        ],

        ['query.graphql', 'query { bar  }'],
        ['fragments.graphql', 'fragment Ep on Episode {\n created \n}'],
      ],
    });
    await project.lsp.handleInitializeRequest({
      rootPath: project.root,
      rootUri: project.root,
      capabilities: {},
      processId: 200,
      workspaceFolders: null,
    });
    await project.lsp.handleDidOpenOrSaveNotification({
      textDocument: { uri: project.uri('query.graphql') },
    });
    await project.lsp.handleDidChangeNotification({
      textDocument: { uri: project.uri('query.graphql'), version: 1 },
      contentChanges: [{ text: 'query { episodes { results { ...Ep } }  }' }],
    });
    expect(project.lsp._logger.error).not.toHaveBeenCalled();
    // console.log(project.lsp._graphQLCache.getSchema('schema.graphql'));
    expect(await project.lsp._graphQLCache.getSchema()).toBeDefined();
    const file = readFileSync(
      join(
        '/tmp/graphql-language-service/test/projects/default/generated-schema.graphql',
      ),
    );
    expect(file.toString('utf-8').split('\n').length).toBeGreaterThan(10);
    const hover = await project.lsp.handleHoverRequest({
      position: {
        character: 10,
        line: 0,
      },
      textDocument: { uri: project.uri('query.graphql') },
    });
    expect(project.lsp._textDocumentCache.size).toEqual(3);

    expect(hover.contents).toContain('Get the list of all episodes');
    const definitions = await project.lsp.handleDefinitionRequest({
      textDocument: { uri: project.uri('query.graphql') },
      position: { character: 33, line: 0 },
    });
    // ensure that fragment definitions work
    expect(definitions[0].uri).toEqual(project.uri('fragments.graphql'));
    expect(JSON.parse(JSON.stringify(definitions[0].range))).toEqual({
      start: {
        line: 0,
        character: 0,
      },
      end: {
        line: 2,
        character: 1,
      },
    });
  });
});
