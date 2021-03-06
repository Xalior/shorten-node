/*
*   shorten-node - A URL Shortening web app
*    URL Routes
*    There are 5 routes here:
*     - index, and developer (static pages)
*     - navLink, setLink, and getLink
*
*    Andrew Kish, Feb 2012
*/

var Shorten = require('./shorten'); //Utility functions for shoterner
var sanitize = require('validator').sanitize; //For XSS prevention

//We pass the app context to the shorten utility handlers since it needs access too
var Routes = function(app){
    this.app = app;
    shorten = new Shorten(app);
};

/*
* Landing and developer info pages, two functions as simple as it gets
*
*/
Routes.prototype.index = function (req, res){
    res.render('index', {devmode: req.app.settings.env, domain: req.app.set('domain')});
};
Routes.prototype.developers = function (req, res){
    res.render('developers', {devmode: req.app.settings.env, domain: req.app.set('domain')});
};

/*
*    Navigate to a shortened link
*     Accepts a 6-32 alphanumeric get request: (http://kish.cm/{thisText})
*     Returns 302 redirect to either the original URL or back to homepage with an error
*    ALSO: Logs link navigation for stats
*/
Routes.prototype.navLink = function (req, res){
    var linkHash = req.route.params[0];
    //Is the linkHash ONLY alphanumeric and between 6-32 characters?
    if (shorten.isValidLinkHash(linkHash)){

        //Gather and clean the data required for logging this hash
        var ipaddress = req.connection.remoteAddress === undefined ? "0.0.0.0" : req.connection.remoteAddress;
        var referrer = req.header('Referrer') === undefined ? "" : req.header('Referrer');
        var userAgent = req.headers['user-agent'] === undefined ? "" : req.headers['user-agent'];
        //Here is the actual object that we will pass to the logger
        var userInfo = {'ip'       : sanitize(ipaddress).xss(),
                        'userAgent': sanitize(userAgent).xss(),
                        'referrer' : sanitize(referrer).xss() };

        //Do we have that URL? If so, log it and send them
        shorten.linkHashLookUp(linkHash, userInfo, function(linkInfo, dbCursor){
            if (linkInfo !== false){
                //We know that hash, send them!
                //console.log("Linking user to: " + linkInfo.linkDestination);
                res.redirect(linkInfo.linkDestination);
            }else{
                linkHash = sanitize(linkHash).xss();
                res.render('index', {errorMessage: 'No such link shortened with hash: \'' + linkHash + '\''});
            }
        });
    }
};

/*
*
* Set a new shortened link
*    Accepts a form-POST'd "originalURL" - the URL the user wants shortened.
*    Returns a json object with the shortened link information that looks like this:
*    {shortenError: false, alreadyShortened: false, originalURL: "http://derp.net", shortenedURL: "http://kish.cm/xxxxxx"}
*
*/
Routes.prototype.setLink = function (req, res){
    var shortenURL = req.body.originalURL;
    var domain = req.app.set('domain');
    var shortened = {
        shortenError: null, //false for no error, otherwise string with error
        alreadyShortened: null, //Boolean for if we already had this URL shortened
        originalURL: null, //the url we shortened
        shortenedURL: null //the full shortlink, including http://
    };
    if (shortenURL === undefined){
        shortenURL = ""; //empty or invalid POST variable
    }
    //Make sure prefix is good
    var httpSearch = shortenURL.search(/^(ftp|http|https):\/\//);
    if (httpSearch == -1){
        //Didn't find a prefix? Just assume http://
        shortenURL = "http://"+shortenURL;
    }
    
    //This is the URL we're shortening
    shortened.originalURL = shortenURL;

    //Make sure link mostly looks like a URL
    if (shorten.isURL(shortenURL)){
        //Check to make sure we haven't already shortened this url
        shorten.originalURLLookUp(shortenURL, function(originalURLCheck){
           if (originalURLCheck === false){
                //Add to db
                shorten.addNewShortenLink(shortenURL, function(shortURL){
                    shortened.shortenedURL = "http://" + domain + "/" + shortURL.linkHash;
                    shortened.shortenError = false;
                    shortened.alreadyShortened = false;
                    res.json(shortened);
                });
            }else{
                //Give them the old hash
                shortened.shortenedURL = "http://" + domain + "/" + originalURLCheck.linkHash;
                shortened.shortenError = false;
                shortened.alreadyShortened = true;
                res.json(shortened);
            }
        });
    }else{
        //Throw an error - not a real or supported URI
        shortened.shortenError = "Invalid or unsupported URI";
        res.json(shortened);
    }
};

/*
*
* Get info about a shortened link
*    Accepts a known short link form-POST'd "shortened_url" - eg ("http://kish.cm/yyyxxx")
*     Returns a json object with detailed stats and information
*
*/
Routes.prototype.getLink = function (req, res){
	var shortenedURL = req.body.shortenedURL;
    //Strip domain
    shortenedURL = shortenedURL.replace("http://" + req.app.set('domain') + "/", "");
	if (shorten.isValidLinkHash(shortenedURL)){
        //Get stats
		shorten.shortenedURLStats(shortenedURL, function(linkStats){
            //console.log("link stats");
            //console.log(linkStats);
			res.json(linkStats);
		});
	}else{
		//404 - no shortlink found with that hash
        var errorResponse ={'originalURL': null,
                            'linkHash': null,
                            'timesUsed': null,
                            'lastUse': null,
                            'topReferrals': {},
                            'topUserAgents':{},
                            'error': 'Not a Kish.cm URL, or not a valid shortened hash'
                            };
		res.json(errorResponse);
	}
};

/*
* Custom error handler
*
*/
Routes.prototype.errorHandler = function(err, req, res, next){

    if (err.status == 404){
        console.error(new Date().toLocaleString(), '>> 404 :', req.params[0], ' UA: ', req.headers['user-agent'], 'IP: ', req.ip);
    }

    if(!err.name || err.name == 'Error'){
        console.error(new Date().toLocaleString(), '>>', err);
        console.log(err.stack);

        if(req.xhr){
            return res.send({ error: 'Internal error' }, 500);
        }else{
            return res.render('errors/500.html', {
                status: 500,
                error: err,
                title: 'Oops! Something went wrong!',
                devmode: req.app.settings.env,
                domain: req.app.set('domain')
            });
        }
    }

    if(req.xhr){
        return res.json({ error: err.message, stack: err.stack, allError: err}, 500);
    }

    if (err.status === undefined){
        res.render('errors/500.html', {
            status: err.name,
            error: err.name,
            showStack: err.stack,
            title: err.message,
            devmode: req.app.settings.env,
            domain: req.app.set('domain')
        });
    }else{
        res.render('errors/' + err.status + '.html', {
            status: err.status,
            error: err.name,
            title: err.message,
            showStack: err.stack,
            devmode: req.app.settings.env,
            domain: req.app.set('domain')
        });
    }
};

module.exports = Routes;
