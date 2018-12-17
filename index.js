#!/usr/bin/env node
'use strict';

const pkg = require( './package.json' );
const usage = `${ pkg.name } ${ pkg.version } by ${ pkg.author }
${ pkg.homepage }

USAGE:
   ${ pkg.name } <nomor-rekening> <ibank-username> <ibank-password> [option..]

OPTIONS:
   -n           Number of PDF to download. Starting from previous month.
                Default to 24.

   --timeout    Global timeout for puppeteer wait actions.
                Default to 10000 (in milliseconds).
   --headless   Run Chrome in headless mode.
   --dir        Directory to store downloaded PDFs and/or converted pdftotext
                files. Default to current directory.
   --pdftotext  Binary filepath of pdftotext program. If not specified, it
                assumes pdftotext is available in $PATH.

   --version    Show current version of bca-estatement-downloader.
   --help       Show usage.
`;

const argv = require( 'minimist' )( process.argv.slice( 2 ) );
const options = {
	headless: typeof argv.headless !== 'undefined',
	maxDownload: parseInt( argv.n ) || 24,
	dir: argv.dir || __dirname,
	timeout: parseInt( argv.timeout ) || 10000,
	pdftotext: argv.pdftotext || 'pdftotext'
};

if ( argv.version ) {
	console.log( pkg.version );
	process.exit( 0 );
}

const showUsage = (
	argv._.length != 3
	||
	options.maxDownload <= 0
	||
	options.timeout <= 0
	||
	argv.help
);
if ( showUsage ) {
	console.log( usage );
	process.exit( 1 );
}

const Downloader = require( './downloader.js' );
const downloader = new Downloader(
	argv._[0].toString(),
	argv._[1].toString(),
	argv._[2].toString(),
	options
);
downloader.download();
