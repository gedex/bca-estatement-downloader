/**
 * External dependencies
 */
const { execSync } = require( 'child_process' );
const { renameSync, rmdirSync, readdirSync, existsSync } = require( 'fs' );
const cmdExistsSync = require( 'command-exists' ).sync;
const mkdirp = require( 'mkdirp' );
const path = require( 'path' );
const puppeteer = require( 'puppeteer' );
const tmp = require( 'tmp' );

const LOGIN_URL = 'https://ibank.klikbca.com/authentication.do';
const E_STATEMENT_URL = 'https://ibank.klikbca.com/estatement.do?value(actions)=estmt';

const USERNAME_FIELD = '#user_id';
const PASSWORD_FIELD = '#pswd';
const LOGIN_BUTTON = 'input[name="value(Submit)"]';
const ACCOUNT_SELECT = '#A1';
const MONTH_SELECT = '#monthVal';
const YEAR_SELECT = '#yearVal';
const DOWNLOAD_BUTTON = 'input[name="value(submit)"]';

const NOOP = () => {};

class Downloader {
	constructor( accountNo, username, password, options ) {
		this.accountNo = accountNo;
		this.username = username;
		this.password = password;
		this.options = options;
		this.actionOptions = {
			timeout: options.timeout
		};

		if ( this.options.dir[0] === '~' ) {
			this.options.dir = path.join( require( 'os' ).homedir(), this.options.dir.slice( 1 ) );
		}

		this.startBrowser = this.startBrowser.bind( this );
		this.login = this.login.bind( this );
		this.logout = this.logout.bind( this );
		this.bulkDownloadEStatement = this.bulkDownloadEStatement.bind( this );
		this.handleDialog = this.handleDialog.bind( this );
		this.handleError = this.handleError.bind( this );

		this.error = null;
		this.loggedIn = false;
	}

	async download() {
		for ( const task of [ this.startBrowser, this.login, this.bulkDownloadEStatement ] ) {
			await task().catch( this.handleError );
			if ( this.error ) {
				break;
			}
		}

		if ( this.loggedIn ) {
			await this.logout().catch( NOOP );
		}

		if ( this.browser ) {
			await this.browser.close().catch( NOOP );
		}

		if ( this.error ) {
			console.log(
				[
					'Error',
					this.error.type ? ` (${ this.error.type }):` : ':'
				].join( '' ),
				this.error.message
					.split( "\n" )
					.map( s => s.trim() )
					.join( ' ' )
			);
			process.exit( 1 );
		}
	}

	async startBrowser() {
		this.browser = await puppeteer.launch( {
			headless: this.options.headless,
			timeout: this.options.timeout
		} );

		this.page = await this.browser.newPage();
		this.page.on( 'dialog', this.handleDialog );
	}

	async handleDialog( dialog ) {
		const message = dialog.message();

		await dialog.dismiss().catch( NOOP );

		this.handleError( new Error( message ) );
	}

	async login() {
		await this.page.goto( LOGIN_URL, this.actionOptions );

		await this.page.waitForSelector( USERNAME_FIELD, this.actionOptions );
		await this.page.click( USERNAME_FIELD );
		await this.page.keyboard.type( this.username );

		await this.page.waitForSelector( PASSWORD_FIELD, this.actionOptions );
		await this.page.click( PASSWORD_FIELD );
		await this.page.keyboard.type( this.password );


		await this.page.waitForSelector( LOGIN_BUTTON, this.actionOptions );
		await this.page.click( LOGIN_BUTTON );

		await this.page.waitForNavigation( this.actionOptions );

		this.loggedIn = true;
	}

	async logout() {
		const logoutLink = ( await this.page.$x( `//a[text()="[ LOGOUT ]"]` ) )[0];
		if ( ! logoutLink ) {
			await Promise.reject( 'Could not find logout link' );
		}
	}

	async bulkDownloadEStatement() {
		await this.page.goto( E_STATEMENT_URL );

		for ( const [ month, year ] of this.getMonthYearToDownload() ) {
			await this.downloadEStatement( month, year );
		}
	}

	async downloadEStatement( month, year ) {
		await this.page.waitForSelector( ACCOUNT_SELECT, this.actionOptions );
		const option = ( await this.page.$x( `//*[@id = "A1"]/option[starts-with(text(), "${ this.accountNo }")]` ) )[0];
		if ( ! option ) {
			await Promise.reject( new Error( `No account no ${ this.accountNo }` ) );
		}

		const optionVal = await ( await option.getProperty( 'value' ) ).jsonValue();
		await this.page.select( ACCOUNT_SELECT, optionVal );

		await this.page.waitForSelector( MONTH_SELECT, this.actionOptions );
		await this.page.select( MONTH_SELECT, month );

		await this.page.waitForSelector( YEAR_SELECT, this.actionOptions );
		await this.page.select( YEAR_SELECT, year );

		console.log( `Downloading eStatement ${ month }/${ year }..` );
		const filename = await this.downloadPdf();
		console.log( `Downloaded to ${ path.resolve( this.options.dir, filename ) }` );

		if ( cmdExistsSync( this.pdftotext ) || existsSync( this.pdftotext ) ) {
			console.log( `Converting ${ filename } to text..` );
			const txtFilename = this.convertPdfToText( filename );
			console.log( `Converted to ${ path.resolve( this.options.dir, txtFilename ) }` );
		}
	}

	async downloadPdf() {
		const downloadPath = tmp.dirSync().name;

		await this.page._client.send( 'Page.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: downloadPath
		} );

		await this.page.waitForSelector( DOWNLOAD_BUTTON, this.actionOptions);
		await this.page.click( DOWNLOAD_BUTTON );

		const filename = await this.waitPdfToDownload( downloadPath );
		const src = path.resolve( downloadPath, filename );
		const dst = path.resolve( this.options.dir, filename );

		renameSync( src, dst );
		rmdirSync( downloadPath );

		return filename;
	}

	async waitPdfToDownload( downloadPath ) {
		let counter = 0;
		let filename;
		while ( ! filename || filename.endsWith( '.crdownload' ) ) {
			filename = readdirSync( downloadPath )[0];
			await this.page.waitFor( 500 );

			counter += 500;
			if ( counter > this.options.timeout ) {
				await Promise.reject( new Error( 'Timeout waiting to downlaod' ) );
			}
		}

		return filename;
	}

	convertPdfToText( filename ) {
		const name = path.basename( filename, '.pdf' );
		const src = path.resolve( this.options.dir, filename );
		const dst = path.resolve( this.options.dir, name, '.txt' );

		execSync( `${ this.pdftotext } -layout ${ src } ${ dst }` );

		return path.resolve( name, '.txt' );
	}

	getMonthYearToDownload() {
		const date = new Date();
		const month = date.getMonth() + 1;
		const year = date.getFullYear();

		const d = [];
		let j = month - 1;
		for ( let i = year; i > ( year - 2 ); i-- ) {
			if ( d.length >= 24 ) {
				break;
			}
			while ( j > 0 ) {
				d.push( [ j.toString(), i.toString() ] );
				j--;
			}
			j = 12;
		}

		return d;
	}

	handleError( error ) {
		if ( ! this.error ) {
			this.error = error;
		}
	}
}

module.exports = Downloader
