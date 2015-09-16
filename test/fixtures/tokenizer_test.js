'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    Tokenizer = require('../../lib/tokenizer'),
    testUtils = require('../test_utils');

function tokenize(chunks, initialState, lastStartTag) {
    var tokenizer = new Tokenizer(),
        nextToken = null,
        out = [],
        chunkIdx = 0;

    tokenizer.state = initialState;

    if (lastStartTag)
        tokenizer.lastStartTagName = lastStartTag;

    function writeChunk() {
        var chunk = chunks[chunkIdx];

        tokenizer.write(chunk, ++chunkIdx === chunks.length);
    }

    writeChunk();

    do {
        nextToken = tokenizer.getNextToken();

        //NOTE: append current token to the output sequence in html5lib test suite compatible format
        switch (nextToken.type) {
            case Tokenizer.CHARACTER_TOKEN:
            case Tokenizer.NULL_CHARACTER_TOKEN:
            case Tokenizer.WHITESPACE_CHARACTER_TOKEN:
                out.push(['Character', nextToken.chars]);
                break;

            case Tokenizer.START_TAG_TOKEN:
                var reformatedAttrs = {};

                nextToken.attrs.forEach(function (attr) {
                    reformatedAttrs[attr.name] = attr.value;
                });

                var startTagEntry = [
                    'StartTag',
                    nextToken.tagName,
                    reformatedAttrs
                ];

                if (nextToken.selfClosing)
                    startTagEntry.push(true);

                out.push(startTagEntry);
                break;

            case Tokenizer.END_TAG_TOKEN:
                out.push(['EndTag', nextToken.tagName]);
                break;

            case Tokenizer.COMMENT_TOKEN:
                out.push(['Comment', nextToken.data]);
                break;

            case Tokenizer.DOCTYPE_TOKEN:
                out.push([
                    'DOCTYPE',
                    nextToken.name,
                    nextToken.publicId,
                    nextToken.systemId,
                    !nextToken.forceQuirks
                ]);
                break;

            case Tokenizer.HIBERNATION_TOKEN:
                writeChunk();
                break;
        }
    } while (nextToken.type !== Tokenizer.EOF_TOKEN);

    return concatCharacterTokens(out);
}

function unicodeUnescape(str) {
    return str.replace(/\\u([\d\w]{4})/gi, function (match, chCodeStr) {
        return String.fromCharCode(parseInt(chCodeStr, 16));
    });
}

function unescapeDescrIO(testDescr) {
    testDescr.input = unicodeUnescape(testDescr.input);

    testDescr.output.forEach(function (tokenEntry) {
        if (tokenEntry === 'ParseError')
            return;

        //NOTE: unescape token tagName (for StartTag and EndTag tokens), comment data (for Comment token),
        //character token data (for Character token).
        tokenEntry[1] = unicodeUnescape(tokenEntry[1]);

        //NOTE: unescape token attributes(if we have them).
        if (tokenEntry.length > 2) {
            Object.keys(tokenEntry).forEach(function (attrName) {
                var attrVal = tokenEntry[attrName];

                delete tokenEntry[attrName];
                tokenEntry[unicodeUnescape(attrName)] = unicodeUnescape(attrVal);
            });
        }
    });
}

function concatCharacterTokens(tokenEntries) {
    var result = [];

    tokenEntries.forEach(function (tokenEntry) {
        if (tokenEntry[0] === 'Character') {
            var lastEntry = result[result.length - 1];

            if (lastEntry && lastEntry[0] === 'Character') {
                lastEntry[1] += tokenEntry[1];
                return;
            }
        }

        result.push(tokenEntry);
    });

    return result;
}

function getTokenizerSuitableStateName(testDataStateName) {
    return testDataStateName.toUpperCase().replace(/\s/g, '_');
}

function loadTests() {
    var dataDirPath = path.join(__dirname, '../data/tokenization'),
        testSetFileNames = fs.readdirSync(dataDirPath),
        testIdx = 0,
        tests = [];

    testSetFileNames.forEach(function (fileName) {
        var filePath = path.join(dataDirPath, fileName),
            testSetJson = fs.readFileSync(filePath).toString(),
            testSet = JSON.parse(testSetJson),
            testDescrs = testSet.tests,
            setName = fileName.replace('.test', '');

        testDescrs.forEach(function (descr) {
            if (!descr.initialStates)
                descr.initialStates = ['Data state'];

            if (descr.doubleEscaped)
                unescapeDescrIO(descr);

            var expected = [];

            descr.output.forEach(function (tokenEntry) {
                if (tokenEntry !== 'ParseError')
                    expected.push(tokenEntry);
            });

            descr.initialStates.forEach(function (initialState) {
                tests.push({
                    idx: ++testIdx,
                    setName: setName,
                    name: descr.description,
                    input: descr.input,
                    expected: concatCharacterTokens(expected),
                    initialState: getTokenizerSuitableStateName(initialState),
                    lastStartTag: descr.lastStartTag
                });
            });
        });
    });

    return tests;
}

function getFullTestName(test) {
    return ['Tokenizer - ' +
            test.idx, '.', test.setName, ' - ', test.name, ' - Initial state: ', test.initialState].join('');
}

//Here we go..
loadTests().forEach(function (test) {
    exports[getFullTestName(test)] = function () {
        var chunks = testUtils.makeChunks(test.input);
        var out = tokenize(chunks, test.initialState, test.lastStartTag);

        assert.deepEqual(out, test.expected, 'Chunks: ' + JSON.stringify(chunks));
    };
});
